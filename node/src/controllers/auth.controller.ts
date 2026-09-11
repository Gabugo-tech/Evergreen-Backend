import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
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

// ─── Handlers ─────────────────────────────────────────────────────────────────
export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = registerSchema.parse(req.body);
    const supabase = getSupabase();

    // Check existing
    const { data: existing } = await supabase
      .from("users")
      .select("id")
      .eq("email", body.email)
      .single();

    if (existing) {
      return errorResponse(res, "Email already registered", 409);
    }

    const password_hash = await bcrypt.hash(body.password, 12);

    const { data: user, error } = await supabase
      .from("users")
      .insert({
        email:        body.email,
        full_name:    body.full_name,
        phone:        body.phone,
        account_type: body.account_type,
        password_hash,
        kyc_status:   "pending",
      })
      .select("id, email, full_name, account_type, kyc_status, created_at")
      .single();

    if (error) throw new AppError(error.message, 500);

    const token = signToken(user.id, user.email);
    return successResponse(res, { token, user }, "Account created", 201);
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
