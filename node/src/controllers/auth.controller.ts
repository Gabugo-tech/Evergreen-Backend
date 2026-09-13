import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../services/supabase";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

// ─── Schemas ──────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  full_name:    z.string().min(2),
  email:        z.string().email(),
  phone:        z.string().min(7),
  password:     z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  account_type: z.enum(["personal", "business"]).default("personal"),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function signToken(userId: string, email: string, role = "user"): string {
  const secret = process.env.JWT_SECRET!;
  const expiresIn = (process.env.JWT_EXPIRES_IN ?? "7d") as string;
  return jwt.sign({ sub: userId, email, role }, secret, { expiresIn } as jwt.SignOptions);
}

/** Generate a unique 10-digit account number prefixed with EG */
function generateAccountNumber(): string {
  const digits = Math.floor(Math.random() * 9_000_000_000 + 1_000_000_000).toString();
  return `EG${digits}`;
}

/** Ensure account number is unique — retry up to 5 times */
async function uniqueAccountNumber(): Promise<string> {
  const supabase = getSupabase();
  for (let i = 0; i < 5; i++) {
    const num = generateAccountNumber();
    const { data } = await supabase
      .from("bank_accounts")
      .select("id")
      .eq("account_number", num)
      .maybeSingle();
    if (!data) return num;
  }
  // Fallback: use UUID suffix
  return `EG${Date.now().toString().slice(-10)}`;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body     = registerSchema.parse(req.body);
    const supabase = getSupabase();

    // Check existing user
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", body.email)
      .maybeSingle();

    if (existing) return errorResponse(res, "Email already registered", 409);

    const password_hash = await bcrypt.hash(body.password, 12);
    const userId        = uuidv4();

    // Create user
    const { data: user, error: userErr } = await supabase
      .from("users")
      .insert({
        id:           userId,
        email:        body.email,
        full_name:    body.full_name,
        phone:        body.phone,
        account_type: body.account_type,
        password_hash,
        kyc_status:   "pending",
      })
      .select("id, email, full_name, account_type, kyc_status, created_at")
      .single();

    if (userErr) throw new AppError(userErr.message, 500);

    // Create primary checking account with a generated account number
    const accountNumber = await uniqueAccountNumber();
    const { error: accErr } = await supabase
      .from("bank_accounts")
      .insert({
        user_id:           userId,
        account_number:    accountNumber,
        account_name:      `${body.full_name} — Checking`,
        account_type:      "checking",
        currency:          "USD",
        balance:           0,
        available_balance: 0,
        is_primary:        true,
      });

    if (accErr) throw new AppError(accErr.message, 500);

    // Log visitor sign-up notification handled by DB trigger
    const token = signToken(user.id, user.email);
    return successResponse(res, { token, user, account_number: accountNumber }, "Account created", 201);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const supabase = getSupabase();

    const { data: user, error } = await supabase
      .from("users")
      .select("id, email, full_name, account_type, kyc_status, password_hash")
      .eq("email", email)
      .single();

    if (error || !user) return errorResponse(res, "Invalid credentials", 401);

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return errorResponse(res, "Invalid credentials", 401);

    const { password_hash: _, ...safeUser } = user;
    const token = signToken(user.id, user.email);
    return successResponse(res, { token, user: safeUser }, "Login successful");
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: Request, res: Response) {
  return successResponse(res, null, "Logged out successfully");
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { token: oldToken } = req.body as { token: string };
    if (!oldToken) return errorResponse(res, "Token required", 400);

    const secret = process.env.JWT_SECRET!;
    const payload = jwt.verify(oldToken, secret, { ignoreExpiration: true }) as any;
    const token = signToken(payload.sub, payload.email, payload.role);
    return successResponse(res, { token }, "Token refreshed");
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    // In production: generate OTP, store in DB with expiry, send email
    // For now we just confirm the request was received
    return successResponse(res, { email }, "Reset code sent if account exists");
  } catch (err) {
    next(err);
  }
}

export async function verifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, otp } = z.object({
      email: z.string().email(),
      otp:   z.string().length(6),
    }).parse(req.body);

    // TODO: verify OTP from DB/cache
    return successResponse(res, { verified: true }, "OTP verified");
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, otp, password } = z.object({
      email:    z.string().email(),
      otp:      z.string().length(6),
      password: z.string().min(8),
    }).parse(req.body);

    const supabase = getSupabase();
    const password_hash = await bcrypt.hash(password, 12);

    const { error } = await supabase
      .from("users")
      .update({ password_hash })
      .eq("email", email);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, null, "Password reset successfully");
  } catch (err) {
    next(err);
  }
}
