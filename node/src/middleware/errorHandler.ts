import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error({
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
    requestId: req.headers["x-request-id"],
  });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Zod validation error
  if (err.name === "ZodError") {
    res.status(422).json({
      success:  false,
      message:  "Validation failed",
      details:  (err as any).errors,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Generic unhandled error — don't leak stack in production
  res.status(500).json({
    success:  false,
    message:  process.env.NODE_ENV === "production"
      ? "An internal error occurred"
      : err.message,
    timestamp: new Date().toISOString(),
  });
}
