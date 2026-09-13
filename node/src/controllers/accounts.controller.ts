import { Response, NextFunction } from "express";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

/** Generate a unique 10-digit numeric account number (no prefix) */
async function generateUniqueAccountNumber(): Promise<string> {
  const supabase = getSupabase();
  for (let i = 0; i < 10; i++) {
    const first = Math.floor(Math.random() * 9 + 1).toString();
    const rest  = Math.floor(Math.random() * 1_000_000_000).toString().padStart(9, "0");
    const num   = `${first}${rest}`;
    const { data } = await supabase
      .from("bank_accounts").select("id").eq("account_number", num).maybeSingle();
    if (!data) return num;
  }
  return Date.now().toString().slice(-10).padStart(10, "1");
}

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

/** Lookup account by number — handles both pure-digit and legacy EG-prefixed formats.
 *  Returns account holder name, type and currency only. Requires auth. */
export async function lookupAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const raw = req.params.account_number?.trim() ?? "";

    // Normalise: strip spaces and dashes, uppercase
    const normalised = raw.replace(/[\s\-]/g, "").toUpperCase();

    if (!normalised || normalised.length < 5) {
      return errorResponse(res, "Account number too short", 400);
    }

    const supabase = getSupabase();

    // Build candidate list: try exact match, and if it starts with EG also try without prefix (and vice versa)
    const candidates: string[] = [normalised];
    if (normalised.startsWith("EG")) {
      candidates.push(normalised.slice(2)); // strip EG prefix → pure digits
    } else if (/^\d+$/.test(normalised)) {
      candidates.push(`EG${normalised}`);   // add EG prefix → legacy format
    }

    let account: { account_number: string; account_name: string; currency: string; account_type: string; user_id: string } | null = null;

    for (const candidate of candidates) {
      const { data, error } = await supabase
        .from("bank_accounts")
        .select("account_number, account_name, currency, account_type, user_id")
        .eq("account_number", candidate)
        .maybeSingle();
      if (error) throw new AppError(error.message, 500);
      if (data) { account = data; break; }
    }

    if (!account) return errorResponse(res, "Account not found", 404);

    // Fetch owner's full name
    const { data: owner } = await supabase
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

    const accountNumber = await generateUniqueAccountNumber();

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
