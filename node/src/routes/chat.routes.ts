import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { chat } from "../controllers/chat.controller";
import rateLimit from "express-rate-limit";

// 30 messages per minute per user — prevents AI cost abuse
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many messages — please slow down." },
});

const router = Router();
router.use(authenticate, chatLimiter);
router.post("/", chat);

export default router;
