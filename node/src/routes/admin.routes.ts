import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/admin.controller";

const router = Router();

// Visitor logging — no auth required (called from frontend on page load)
router.post("/visitors", ctrl.logVisitor);

// All routes below require authentication
router.use(authenticate);

router.get("/users",        ctrl.listUsers);
router.get("/transactions", ctrl.listAllTransactions);
router.get("/account",      ctrl.getAdminAccount);

export default router;
