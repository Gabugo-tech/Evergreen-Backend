import { Router } from "express";
import { authenticate } from "../middleware/auth";
import * as ctrl from "../controllers/payments.controller";

const router = Router();
router.use(authenticate);

// POST /api/payments/send           — initiate a transfer
router.post("/send",         ctrl.sendMoney);

// POST /api/payments/exchange       — currency exchange
router.post("/exchange",     ctrl.exchange);

// GET  /api/payments/rates          — live FX rates
router.get("/rates",         ctrl.getFxRates);

// GET  /api/payments/rates/:from/:to — specific pair rate
router.get("/rates/:from/:to", ctrl.getPairRate);

// GET  /api/payments/history        — past payments
router.get("/history",       ctrl.getPaymentHistory);

// POST /api/payments/:id/cancel     — cancel pending payment
router.post("/:id/cancel",   ctrl.cancelPayment);

export default router;
