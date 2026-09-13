import { Response, NextFunction } from "express";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

const ADMIN_EMAIL      = "nnanwubagabriel@gmail.com";
const ADMIN_ACCOUNT_ID = "admin-test-00000000-0000-0000-0000-000000000001";

function isAdmin(req: AuthRequest): boolean {
  return req.user?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// ─── Users (admin) ────────────────────────────────────────────────────────────
export async function listUsers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isAdmin(req)) return errorResponse(res, "Forbidden", 403);
    const limit  = Number(req.query.limit ?? 100);
    const { data, error } = await getSupabase()
      .from("users")
      .select("id, email, full_name, phone, account_type, kyc_status, is_active, country, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data ?? []);
  } catch (err) { next(err); }
}

// ─── Transactions (admin) ─────────────────────────────────────────────────────
export async function listAllTransactions(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isAdmin(req)) return errorResponse(res, "Forbidden", 403);
    const limit = Number(req.query.limit ?? 200);
    const { data, error } = await getSupabase()
      .from("transactions")
      .select(`
        id, description, amount, currency, type, status,
        reference, recipient_name, category, created_at,
        users!inner(email)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new AppError(error.message, 500);
    // Flatten user email
    const flat = (data ?? []).map((t: any) => ({
      ...t,
      user_email: t.users?.email ?? null,
      users: undefined,
    }));
    return successResponse(res, flat);
  } catch (err) { next(err); }
}

// ─── Admin test account ───────────────────────────────────────────────────────
export async function getAdminAccount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!isAdmin(req)) return errorResponse(res, "Forbidden", 403);
    const { data, error } = await getSupabase()
      .from("bank_accounts")
      .select("id, account_number, balance, currency, account_name")
      .eq("id", ADMIN_ACCOUNT_ID)
      .single();
    if (error || !data) {
      // Account not seeded yet
      return successResponse(res, {
        id: ADMIN_ACCOUNT_ID,
        account_number: "ADMIN-TEST-001",
        balance: 1_000_000_000,
        currency: "USD",
        account_name: "Evergreen Admin Test Account",
      });
    }
    return successResponse(res, data);
  } catch (err) { next(err); }
}

// ─── Visitor log ──────────────────────────────────────────────────────────────
export async function logVisitor(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      page:       z.string().default("/"),
      user_id:    z.string().uuid().optional().nullable(),
      user_email: z.string().email().optional().nullable(),
    }).parse(req.body);

    const ip = (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim() ??
      req.socket?.remoteAddress ??
      "unknown"
    );

    const ua = req.headers["user-agent"] ?? "";

    await getSupabase()
      .from("visitor_logs")
      .insert({
        ip_address: ip,
        user_agent: ua.slice(0, 500),
        page:       body.page,
        user_id:    body.user_id  ?? null,
        user_email: body.user_email ?? null,
      });

    return successResponse(res, null, "Logged");
  } catch (err) { next(err); }
}
