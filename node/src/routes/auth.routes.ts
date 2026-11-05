import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { otpLimiter } from "../middleware/limiters";
import * as ctrl from "../controllers/auth.controller";

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post("/register",       ctrl.register);
router.post("/login",          ctrl.login);
router.post("/logout",         ctrl.logout);
router.post("/refresh",        ctrl.refresh);
router.post("/forgot-password",ctrl.forgotPassword);

// OTP endpoints get extra strict limiting (5 req / 15 min)
router.post("/verify-otp",     otpLimiter, ctrl.verifyOtp);
router.post("/reset-password", otpLimiter, ctrl.resetPassword);

// ── Authenticated routes ──────────────────────────────────────────────────────
router.post("/set-pin",              authenticate, ctrl.setPaymentPin);
router.post("/verify-pin",           authenticate, ctrl.verifyPaymentPin);
router.post("/request-pin-reset",    authenticate, ctrl.requestPinReset);
router.post("/verify-pin-reset-otp", authenticate, otpLimiter, ctrl.verifyPinResetOtp);
router.post("/reset-pin",            authenticate, otpLimiter, ctrl.resetPaymentPin);

export default router;
