import { Router } from "express";
import * as ctrl from "../controllers/auth.controller";

const router = Router();

// POST /api/auth/register
router.post("/register", ctrl.register);

// POST /api/auth/login
router.post("/login", ctrl.login);

// POST /api/auth/logout
router.post("/logout", ctrl.logout);

// POST /api/auth/refresh
router.post("/refresh", ctrl.refresh);

// POST /api/auth/forgot-password
router.post("/forgot-password", ctrl.forgotPassword);

// POST /api/auth/reset-password
router.post("/reset-password", ctrl.resetPassword);

// POST /api/auth/verify-otp
router.post("/verify-otp", ctrl.verifyOtp);

export default router;
