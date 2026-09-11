import { Response, NextFunction } from "express";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

export async function getProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("users")
      .select("id, email, full_name, phone, avatar_url, account_type, kyc_status, created_at")
      .eq("id", req.user!.id)
      .single();

    if (error || !data) return errorResponse(res, "User not found", 404);
    return successResponse(res, data);
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      full_name: z.string().min(2).optional(),
      phone:     z.string().optional(),
      address:   z.string().optional(),
    }).parse(req.body);

    const { data, error } = await getSupabase()
      .from("users")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", req.user!.id)
      .select("id, email, full_name, phone, avatar_url, account_type, kyc_status")
      .single();

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data, "Profile updated");
  } catch (err) {
    next(err);
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // TODO: handle multipart upload, store in Supabase Storage
    return successResponse(res, { avatar_url: null }, "Avatar upload — coming soon");
  } catch (err) {
    next(err);
  }
}

export async function getKycStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("users")
      .select("kyc_status")
      .eq("id", req.user!.id)
      .single();

    if (error || !data) return errorResponse(res, "User not found", 404);
    return successResponse(res, data);
  } catch (err) {
    next(err);
  }
}

export async function submitKyc(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // TODO: validate document uploads, store in Supabase Storage, trigger review
    const { error } = await getSupabase()
      .from("users")
      .update({ kyc_status: "pending" })
      .eq("id", req.user!.id);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, { kyc_status: "pending" }, "KYC documents submitted");
  } catch (err) {
    next(err);
  }
}
