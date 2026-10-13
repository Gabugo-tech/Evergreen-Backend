import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/admin.controller";

const router = Router();

// Strict rate limiter for admin endpoints — 60 req/15 min
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  message: { error: "Too many admin requests. Please slow down." },
});

// Visitor logging — no auth required (called from frontend on every page load)
router.post("/visitors", ctrl.logVisitor);

// All routes below require JWT authentication + rate limiting
router.use(authenticate, adminLimiter);

// Stats — real counts from DB
router.get("/stats",        ctrl.getStats);

// Users
router.get("/users",        ctrl.listUsers);

// Transactions
router.get("/transactions", ctrl.listAllTransactions);

// Visitors (read)
router.get("/visitors",     ctrl.listVisitors);

// Admin test account
router.get("/account",      ctrl.getAdminAccount);

// Admin transfer history
router.get("/transfers",    ctrl.listAdminTransfers);

// Delete user — removes all DB records
router.delete("/users/:id", ctrl.deleteUser);

// Test email config
router.post("/test-email",  ctrl.testEmail);

export default router;
