import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/accounts.controller";

const router = Router();
router.use(authenticate);

// GET  /api/accounts          — list user's accounts
router.get("/",          ctrl.listAccounts);

// GET  /api/accounts/lookup/:account_number — look up account holder name
router.get("/lookup/:account_number", ctrl.lookupAccount);

// POST /api/accounts          — create a new account
router.post("/",         ctrl.createAccount);

// GET  /api/accounts/:id      — account detail
router.get("/:id",       ctrl.getAccount);

// PATCH /api/accounts/:id     — update account settings
router.patch("/:id",     ctrl.updateAccount);

// GET  /api/accounts/:id/balance — live balance
router.get("/:id/balance", ctrl.getBalance);

// GET  /api/accounts/:id/statement — downloadable statement
router.get("/:id/statement", ctrl.getStatement);

export default router;
