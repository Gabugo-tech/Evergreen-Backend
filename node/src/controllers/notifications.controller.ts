import { Response, NextFunction } from "express";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

export async function listNotifications(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("notifications")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data ?? []);
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { count, error } = await getSupabase()
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user!.id)
      .eq("is_read", false);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, { count: count ?? 0 });
  } catch (err) {
    next(err);
  }
}

export async function markRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("notifications")
      .update({ is_read: true })
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .select()
      .single();

    if (error || !data) return errorResponse(res, "Notification not found", 404);
    return successResponse(res, data, "Marked as read");
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", req.user!.id)
      .eq("is_read", false);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, null, "All notifications marked as read");
  } catch (err) {
    next(err);
  }
}

export async function deleteNotification(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from("notifications")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, null, "Notification deleted");
  } catch (err) {
    next(err);
  }
}

export async function clearAll(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { error } = await getSupabase()
      .from("notifications")
      .delete()
      .eq("user_id", req.user!.id);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, null, "All notifications cleared");
  } catch (err) {
    next(err);
  }
}
