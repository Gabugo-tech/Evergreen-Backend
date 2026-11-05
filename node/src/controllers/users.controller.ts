import { Response, NextFunction, Request } from "express";
import multer from "multer";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

// ─── Multer: memory storage, 5 MB limit, images only ─────────────────────────
// Allowed MIME types — SVG excluded to prevent stored XSS
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Magic byte signatures for server-side file type verification
const MAGIC_BYTES: Record<string, number[][]> = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png":  [[0x89, 0x50, 0x4E, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF....WEBP
  "image/gif":  [[0x47, 0x49, 0x46, 0x38]],
};

function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;
  return signatures.some(sig =>
    sig.every((byte, i) => buffer[i] === byte)
  );
}

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed"));
    }
  },
});

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
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) return errorResponse(res, "No file uploaded", 400);

    // Server-side magic-byte validation — MIME type from headers is client-supplied
    if (!validateMagicBytes(file.buffer, file.mimetype)) {
      return errorResponse(res, "File content does not match declared image type", 400);
    }

    const supabase  = getSupabase();
    const userId    = req.user!.id;
    const ext       = file.mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const path      = `avatars/${userId}.${ext}`;

    // Upsert into Supabase Storage bucket "avatars" (create it if it doesn't exist)
    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert:      true,         // overwrite previous avatar
      });

    if (uploadErr) throw new AppError(uploadErr.message, 500);

    // Get the public URL
    const { data: urlData } = supabase.storage
      .from("avatars")
      .getPublicUrl(path);

    const avatar_url = urlData.publicUrl;

    // Persist to users table
    const { data, error: updateErr } = await supabase
      .from("users")
      .update({ avatar_url, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id, email, full_name, avatar_url, account_type, kyc_status")
      .single();

    if (updateErr) throw new AppError(updateErr.message, 500);

    return successResponse(res, data, "Avatar updated");
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
