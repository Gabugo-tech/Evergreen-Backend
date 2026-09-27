import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/auth.controller";

const router = Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.post("/register",       ctrl.register);
router.post("/login",          ctrl.login);
router.post("/logout",         ctrl.logout);
router.post("/refresh",        ctrl.refresh);
router.post("/forgot-password",ctrl.forgotPassword);
router.post("/verify-otp",     ctrl.verifyOtp);
router.post("/reset-password", ctrl.resetPassword);

// ── Authenticated routes ──────────────────────────────────────────────────────
// POST /api/auth/set-pin           — set PIN for first time (existing users)
router.post("/set-pin",            authenticate, ctrl.setPaymentPin);

// POST /api/auth/verify-pin        — verify payment PIN before a transfer
router.post("/verify-pin",         authenticate, ctrl.verifyPaymentPin);

// POST /api/auth/request-pin-reset — send OTP to email for PIN reset
router.post("/request-pin-reset",  authenticate, ctrl.requestPinReset);

// POST /api/auth/reset-pin         — submit OTP + new PIN to complete reset
router.post("/reset-pin",          authenticate, ctrl.resetPaymentPin);

export default router;
