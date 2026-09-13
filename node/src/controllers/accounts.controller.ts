import { Response, NextFunction } from "express";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

export async function listAccounts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("is_primary", { ascending: false });

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data ?? []);
  } catch (err) {
    next(err);
  }
}

/** Lookup account by number — normalises input (strips spaces/dashes) before querying.
 *  Returns account holder name only. Requires auth to prevent enumeration. */
export async function lookupAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const raw = req.params.account_number?.trim() ?? "";

    // Strip all non-alphanumeric characters so "384 726 1950" matches "3847261950"
    // and "EG 3847261950" matches "EG3847261950"
    const accountNumber = raw.replace(/[\s\-]/g, "").toUpperCase();

    if (!accountNumber || accountNumber.length < 5) {
      return errorResponse(res, "Account number too short", 400);
    }

    const { data: account, error } = await getSupabase()
      .from("bank_accounts")
      .select("account_number, account_name, currency, account_type, user_id")
      .eq("account_number", accountNumber)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!account) return errorResponse(res, "Account not found", 404);

    // Fetch the owner's full name
    const { data: owner } = await getSupabase()
      .from("users")
      .select("full_name")
      .eq("id", account.user_id)
      .single();

    return successResponse(res, {
      account_number: account.account_number,
      account_name:   owner?.full_name ?? "Account Holder",
      account_type:   account.account_type,
      currency:       account.currency,
    });
  } catch (err) {
    next(err);
  }
}

export async function getAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .select("*")
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .single();

    if (error || !data) return errorResponse(res, "Account not found", 404);
    return successResponse(res, data);
  } catch (err) {
    next(err);
  }
}

export async function createAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      account_name: z.string().min(2),
      account_type: z.enum(["checking","savings","investment"]),
      currency:     z.string().length(3).default("USD"),
    }).parse(req.body);

    const accountNumber = `EG${Date.now().toString().slice(-10)}`;

    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .insert({
        user_id:          req.user!.id,
        account_number:   accountNumber,
        account_name:     body.account_name,
        account_type:     body.account_type,
        currency:         body.currency,
        balance:          0,
        available_balance: 0,
        is_primary:       false,
      })
      .select()
      .single();

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data, "Account created", 201);
  } catch (err) {
    next(err);
  }
}

export async function updateAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      account_name: z.string().min(2).optional(),
      is_primary:   z.boolean().optional(),
    }).parse(req.body);

    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .update(body)
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error || !data) return errorResponse(res, "Account not found", 404);
    return successResponse(res, data, "Account updated");
  } catch (err) {
    next(err);
  }
}

export async function getBalance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .select("balance, available_balance, currency")
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .single();

    if (error || !data) return errorResponse(res, "Account not found", 404);
    return successResponse(res, { ...data, updated_at: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
}

export async function getStatement(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    let query = getSupabase()
      .from("transactions")
      .select("*")
      .eq("account_id", req.params.id)
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false });

    if (from) query = query.gte("created_at", from);
    if (to)   query = query.lte("created_at", to + "T23:59:59");

    const { data, error } = await query;
    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data ?? [], "Statement retrieved");
  } catch (err) {
    next(err);
  }
}
