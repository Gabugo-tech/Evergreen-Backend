import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/admin.controller";

const router = Router();

// Visitor logging — no auth required (called from frontend on every page load)
router.post("/visitors", ctrl.logVisitor);

// All routes below require JWT authentication
router.use(authenticate);

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

export default router;
