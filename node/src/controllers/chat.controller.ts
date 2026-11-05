import { Response, NextFunction } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";

if (!process.env.GEMINI_API_KEY) {
  console.warn("[chat] GEMINI_API_KEY not set — AI chat will fail");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

const messageSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "model"]),
    parts: z.array(z.object({ text: z.string() })),
  })).max(20).optional().default([]),
});

const SYSTEM_PROMPT = `You are Aria, Evergreen Bank's friendly and knowledgeable AI assistant. 
You help customers with their banking questions in a clear, concise, and professional manner.

About Evergreen Bank:
- A modern digital bank offering personal and business accounts
- Services: local and international transfers, multi-currency accounts, investment portfolio, bill payments
- Supported currencies include USD, EUR, GBP, NGN, and many others
- KYC verification is required for full account access
- Payment PIN is required for all transfers
- Customer support email: evergreenworldbank@gmail.com

Your capabilities:
- Answer questions about account features, transfers, fees, and policies
- Help users understand their account status and transactions
- Guide users through common tasks (how to send money, reset PIN, etc.)
- Provide context-aware answers using the user's account data provided below

Rules:
- Keep responses concise — 2-4 sentences max unless a step-by-step guide is needed
- Never reveal or guess account PINs, passwords, or sensitive credentials
- For issues you can't resolve, direct users to evergreenworldbank@gmail.com
- Always be warm, helpful, and professional
- Format using plain text only — no markdown, no asterisks, no bullet symbols
- If asked about balances or transactions, use the real data provided in the context
- If a user says they did not receive an OTP or email alert, always tell them to check their spam or junk folder first, as emails from Evergreen may be filtered there. If it's still not there after checking, advise them to contact support at evergreenworldbank@gmail.com`;

async function getUserContext(userId: string): Promise<string> {
  const supabase = getSupabase();

  const [profileRes, accountsRes, txRes] = await Promise.allSettled([
    supabase
      .from("users")
      .select("full_name, email, account_type, kyc_status, created_at")
      .eq("id", userId)
      .single(),
    supabase
      .from("bank_accounts")
      .select("account_number, account_type, currency, balance, available_balance, is_primary")
      .eq("user_id", userId)
      .eq("is_active", true),
    supabase
      .from("transactions")
      .select("type, amount, currency, description, status, created_at, recipient_name")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const lines: string[] = ["--- USER CONTEXT (use this to answer account-specific questions) ---"];

  if (profileRes.status === "fulfilled" && profileRes.value.data) {
    const p = profileRes.value.data;
    lines.push(`Customer: ${p.full_name} (${p.email})`);
    lines.push(`Account type: ${p.account_type} | KYC: ${p.kyc_status}`);
    lines.push(`Member since: ${new Date(p.created_at).toLocaleDateString()}`);
  }

  if (accountsRes.status === "fulfilled" && accountsRes.value.data?.length) {
    lines.push("Accounts:");
    for (const a of accountsRes.value.data) {
      lines.push(`  - ${a.currency} ${a.account_type} account (#${a.account_number}): balance ${Number(a.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${a.currency}${a.is_primary ? " (primary)" : ""}`);
    }
  }

  if (txRes.status === "fulfilled" && txRes.value.data?.length) {
    lines.push("Last 5 transactions:");
    for (const t of txRes.value.data) {
      const sign = t.type === "credit" ? "+" : "-";
      const date = new Date(t.created_at).toLocaleDateString();
      lines.push(`  - ${date}: ${sign}${Number(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${t.currency} — ${t.description} (${t.status})`);
    }
  }

  lines.push("--- END CONTEXT ---");
  return lines.join("\n");
}

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { message, history } = messageSchema.parse(req.body);
    const userId = req.user!.id;

    // Fetch real account context for this user
    const userContext = await getUserContext(userId);

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: `${SYSTEM_PROMPT}\n\n${userContext}`,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.7,
      },
    });

    // Start chat with existing history
    const chatSession = model.startChat({ history });

    const result = await chatSession.sendMessage(message);
    const reply  = result.response.text();

    return successResponse(res, { reply }, "OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chat] Gemini error:", msg);

    if (msg.includes("API_KEY") || msg.includes("API key")) {
      return errorResponse(res, "AI service misconfigured — invalid API key.", 503);
    }
    if (msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED")) {
      return errorResponse(res, "AI service quota exceeded. Please try again later.", 503);
    }
    if (msg.includes("SAFETY")) {
      return errorResponse(res, "Your message was blocked by safety filters. Please rephrase.", 400);
    }
    // Return the actual error message in development for easier debugging
    return errorResponse(res, `AI error: ${msg}`, 500);
  }
}
