import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { adminLimiter, visitorLogLimiter } from "../middleware/limiters";
import * as ctrl from "../controllers/admin.controller";

const router = Router();

// Strict rate limiter for admin endpoints — 60 req/15 min (from limiters.ts)

// Visitor logging — unauthenticated but rate-limited to prevent spam
router.post("/visitors", visitorLogLimiter, ctrl.logVisitor);

// All routes below require JWT authentication + rate limiting
router.use(authenticate, adminLimiter);

router.get("/stats",        ctrl.getStats);
router.get("/users",        ctrl.listUsers);
router.get("/transactions", ctrl.listAllTransactions);
router.get("/visitors",     ctrl.listVisitors);
router.get("/account",      ctrl.getAdminAccount);
router.get("/transfers",    ctrl.listAdminTransfers);
router.patch("/users/:id/suspend",   ctrl.suspendUser);
router.patch("/users/:id/unsuspend", ctrl.unsuspendUser);
router.delete("/users/:id",          ctrl.deleteUser);
router.post("/test-email",  ctrl.testEmail);

export default router;
