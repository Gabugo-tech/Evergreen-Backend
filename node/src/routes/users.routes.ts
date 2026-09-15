import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/users.controller";

const router = Router();
router.use(authenticate);

// GET   /api/users/me        — current user profile
router.get("/me",         ctrl.getProfile);

// PATCH /api/users/me        — update profile
router.patch("/me",       ctrl.updateProfile);

// POST  /api/users/me/avatar — upload avatar (multipart/form-data, field: "avatar")
router.post("/me/avatar", ctrl.avatarUpload.single("avatar"), ctrl.uploadAvatar);

// GET   /api/users/me/kyc   — KYC status
router.get("/me/kyc",     ctrl.getKycStatus);

// POST  /api/users/me/kyc   — submit KYC documents
router.post("/me/kyc",    ctrl.submitKyc);

export default router;
