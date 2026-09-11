import { Response } from "express";

export function successResponse<T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function errorResponse(
  res: Response,
  message: string,
  statusCode = 400,
  details?: unknown
) {
  const body: Record<string, unknown> = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };
  if (details !== undefined) body.details = details;
  return res.status(statusCode).json(body);
}

export function paginatedResponse<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  perPage: number,
  message = "Success"
) {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    },
    timestamp: new Date().toISOString(),
  });
}
