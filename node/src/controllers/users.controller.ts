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

/**
 * Detect the actual image type from magic bytes, regardless of declared MIME type.
 * Returns the detected MIME type string, or null if not a recognised image format.
 */
function detectImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return "image/png";

  // WebP: RIFF????WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) return "image/webp";

  // GIF: GIF87a or GIF89a
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return "image/gif";

  return null;
}

function validateMagicBytes(buffer: Buffer, _mimeType: string): boolean {
  // Accept the file if we can detect it as any supported image type,
  // regardless of what MIME type the client declared.
  return detectImageType(buffer) !== null;
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

    // Server-side magic-byte validation — detect actual type from file content
    const detectedType = detectImageType(file.buffer);
    if (!detectedType) {
      return errorResponse(res, "File content does not match declared image type", 400);
    }

    const supabase  = getSupabase();
    const userId    = req.user!.id;
    // Use detected type for extension — don't trust client-declared MIME
    const ext       = detectedType.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
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

export async function removeAvatar(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const supabase = getSupabase();
    const userId   = req.user!.id;

    // Try to delete the file from storage (both jpg and png/webp variants)
    const extensions = ["jpg", "png", "webp", "gif"];
    for (const ext of extensions) {
      await supabase.storage.from("avatars").remove([`avatars/${userId}.${ext}`]);
    }

    // Clear avatar_url in the users table
    const { data, error } = await supabase
      .from("users")
      .update({ avatar_url: null, updated_at: new Date().toISOString() })
      .eq("id", userId)
      .select("id, email, full_name, avatar_url, account_type, kyc_status")
      .single();

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data, "Profile photo removed");
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
