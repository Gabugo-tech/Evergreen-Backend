/**
 * AI Chat controller — powered by OpenRouter (Qwen/qwen3-235b-a22b via OpenAI-compatible API).
 * Model: qwen/qwen3-235b-a22b (free tier available on OpenRouter)
 * API key: OPENROUTER_API_KEY in Railway env
 */
import { Response, NextFunction } from "express";
import { z } from "zod";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";

if (!process.env.OPENROUTER_API_KEY) {
  console.warn("[chat] OPENROUTER_API_KEY not set — AI chat will fail");
}

const messageSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
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

Rules:
- Keep responses concise — 2-4 sentences max unless a step-by-step guide is needed
- Never reveal or guess account PINs, passwords, or sensitive credentials
- For issues you cannot resolve, direct users to evergreenworldbank@gmail.com
- Always be warm, helpful, and professional
- Format using plain text only — no markdown, no asterisks, no bullet symbols
- If asked about balances or transactions, use the real data provided in the context
- If a user says they did not receive an OTP or email alert, always tell them to check their spam or junk folder first, as emails from Evergreen may be filtered there. If still missing, advise them to contact support at evergreenworldbank@gmail.com`;

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
      .select("type, amount, currency, description, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const lines: string[] = ["--- USER CONTEXT ---"];

  if (profileRes.status === "fulfilled" && profileRes.value.data) {
    const p = profileRes.value.data;
    lines.push(`Customer: ${p.full_name} (${p.email})`);
    lines.push(`Account type: ${p.account_type} | KYC: ${p.kyc_status}`);
    lines.push(`Member since: ${new Date(p.created_at).toLocaleDateString()}`);
  }

  if (accountsRes.status === "fulfilled" && accountsRes.value.data?.length) {
    lines.push("Accounts:");
    for (const a of accountsRes.value.data) {
      lines.push(`  - ${a.currency} ${a.account_type} (#${a.account_number}): balance ${Number(a.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${a.currency}${a.is_primary ? " (primary)" : ""}`);
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

    const userContext = await getUserContext(userId);

    const messages = [
      { role: "system",    content: `${SYSTEM_PROMPT}\n\n${userContext}` },
      ...history,
      { role: "user",      content: message },
    ];

    // Retry up to 3 times for transient 503s
    let reply = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type":  "application/json",
          "HTTP-Referer":  "https://evergreen-world-bank.vercel.app",
          "X-Title":       "Evergreen Bank",
        },
        body: JSON.stringify({
          model:       "qwen/qwen3-235b-a22b:free",
          messages,
          max_tokens:  512,
          temperature: 0.7,
        }),
      });

      if (response.status === 503 && attempt < 3) {
        await new Promise(r => setTimeout(r, attempt * 1500));
        continue;
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as { error?: { message?: string } };
        const msg = err?.error?.message ?? `OpenRouter error ${response.status}`;
        throw new Error(msg);
      }

      const data = await response.json() as {
        choices: { message: { content: string } }[];
      };
      reply = data.choices?.[0]?.message?.content?.trim() ?? "";
      break;
    }

    if (!reply) reply = "I am unable to respond right now. Please try again or contact support at evergreenworldbank@gmail.com.";

    return successResponse(res, { reply }, "OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[chat] OpenRouter error:", msg);

    if (msg.includes("API key") || msg.includes("401") || msg.includes("403")) {
      return errorResponse(res, "AI service misconfigured. Please contact support.", 503);
    }
    if (msg.includes("quota") || msg.includes("429") || msg.includes("rate limit")) {
      return errorResponse(res, "AI service is busy. Please try again in a moment.", 503);
    }
    if (msg.includes("503") || msg.includes("UNAVAILABLE")) {
      return errorResponse(res, "Aria is experiencing high demand. Please try again in a moment.", 503);
    }
    return errorResponse(res, "AI service temporarily unavailable.", 503);
  }
}
