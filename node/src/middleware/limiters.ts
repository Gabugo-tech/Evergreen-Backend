import rateLimit from "express-rate-limit";

const rateLimitOptions = { validate: { xForwardedForHeader: false } };

/** Global limiter — 300 req / 15 min */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  ...rateLimitOptions,
  message: { error: "Too many requests. Please try again later." },
});

/** Auth routes limiter — 20 req / 15 min */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  ...rateLimitOptions,
  message: { error: "Too many auth attempts. Please try again in 15 minutes." },
});

/** OTP endpoints — strict 5 req / 15 min to prevent brute-force */
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  ...rateLimitOptions,
  message: { error: "Too many OTP attempts. Please try again in 15 minutes." },
});

/** Admin routes limiter — 60 req / 15 min */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  ...rateLimitOptions,
  message: { error: "Too many admin requests. Please slow down." },
});

/** Visitor log — unauthenticated, 10 req / 1 min to prevent spam */
export const visitorLogLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  ...rateLimitOptions,
  message: { error: "Too many requests." },
});
