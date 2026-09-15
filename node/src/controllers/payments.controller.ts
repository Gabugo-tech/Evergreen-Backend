import { Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../services/supabase";
import { AuthRequest } from "../middleware/auth";
import { successResponse, errorResponse } from "../utils/response";
import { AppError } from "../middleware/errorHandler";

// Static FX rates relative to USD (in production: fetch from live rate provider)
const FX_RATES: Record<string, number> = {
  USD:1, EUR:0.92, GBP:0.79, NGN:1620, CAD:1.36, AUD:1.53,
  JPY:157, CHF:0.90, INR:84, CNY:7.27, BRL:5.05, MXN:17.1,
  ZAR:18.6, SGD:1.34, AED:3.67,
};

const sendSchema = z.object({
  from_account_id:    z.string().min(1, "Account ID required"),
  to_account_number:  z.string().min(5),
  recipient_name:     z.string().min(2),
  amount:             z.coerce.number().positive(),
  from_currency:      z.string().length(3),
  to_currency:        z.string().length(3),
  description:        z.string().min(1).max(120),
  transfer_type:      z.enum(["local", "international"]),
});

export async function sendMoney(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const body = sendSchema.parse(req.body);
    const supabase = getSupabase();

    // Verify account ownership
    const { data: account, error: accErr } = await supabase
      .from("bank_accounts")
      .select("id, balance, currency")
      .eq("id", body.from_account_id)
      .eq("user_id", req.user!.id)
      .single();

    if (accErr || !account) return errorResponse(res, "Account not found", 404);

    const balanceRaw = account.balance;
    const balance = typeof balanceRaw === "string"
      ? parseFloat(balanceRaw)
      : Number(balanceRaw);

    const fee = body.transfer_type === "international" ? 2.5 : 0;

    // Convert the send amount + fee into the account's native currency before
    // comparing against the balance. Without this, sending $20 USD from an
    // NGN account would compare 20 against ₦50,000 — correct numerically but
    // semantically wrong when currencies differ.
    const accountCurrency  = (account.currency as string).toUpperCase();
    const fromCurrencyUC   = body.from_currency.toUpperCase();
    const accountRate      = FX_RATES[accountCurrency] ?? 1;
    const fromRate         = FX_RATES[fromCurrencyUC]  ?? 1;
    // Convert: amount_in_account_currency = amount_in_from_currency * (accountRate / fromRate)
    const amountInAccountCurrency = body.amount * (accountRate / fromRate);
    const feeInAccountCurrency    = fee         * (accountRate / fromRate);
    const totalDebit              = amountInAccountCurrency + feeInAccountCurrency;

    // Log for debugging on Railway
    console.log(
      `[sendMoney] balance=${balance} ${accountCurrency} | ` +
      `send=${body.amount} ${fromCurrencyUC} → ${amountInAccountCurrency.toFixed(4)} ${accountCurrency} | ` +
      `fee=${fee} → ${feeInAccountCurrency.toFixed(4)} ${accountCurrency} | ` +
      `totalDebit=${totalDebit.toFixed(4)} ${accountCurrency}`
    );

    // International transfers are allowed regardless of balance (credit/overdraft behaviour).
    // Only local transfers are blocked when funds are insufficient.
    if (body.transfer_type === "local" && balance < totalDebit) {
      console.log(`[sendMoney] INSUFFICIENT: balance(${balance}) < totalDebit(${totalDebit.toFixed(4)})`);
      return errorResponse(res, "Insufficient balance", 422);
    }

    // Generate collision-proof references using UUID segments
    const baseRef    = uuidv4().replace(/-/g, "").slice(0, 16).toUpperCase();
    const reference  = `EG${baseRef}`;
    const referenceCR = `${reference}CR`; // credit leg — distinct from debit
    const referenceDR = `${reference}DR`; // debit leg

    // 1. Debit sender — subtract in the account's native currency
    const newBalance = balance - totalDebit;
    const { error: debitErr } = await supabase
      .from("bank_accounts")
      .update({ balance: newBalance })
      .eq("id", body.from_account_id);

    if (debitErr) throw new AppError(debitErr.message, 500);

    // 2. Credit recipient if they have an Evergreen account
    // For external banks (account not found in system), we just record the debit
    // and show success — actual settlement would happen via banking API integration
    const { data: recipientAccount } = await supabase
      .from("bank_accounts")
      .select("id, balance, user_id")
      .eq("account_number", body.to_account_number)
      .maybeSingle();

    if (recipientAccount) {
      // Internal Evergreen transfer — credit immediately
      const recipientBalance = Number(recipientAccount.balance);
      await supabase
        .from("bank_accounts")
        .update({ balance: recipientBalance + body.amount })
        .eq("id", recipientAccount.id);

      try {
        await supabase
          .from("transactions")
          .insert({
            id:               uuidv4(),
            user_id:          recipientAccount.user_id,
            account_id:       recipientAccount.id,
            type:             "credit",
            status:           "completed",
            amount:           body.amount,
            currency:         body.to_currency,
            description:      body.description,
            reference:        referenceCR,
            recipient_name:   body.recipient_name,
            recipient_account: body.to_account_number,
            category:         "Transfer",
          });
      } catch (creditErr) {
        console.warn("[sendMoney] Credit transaction insert failed:", creditErr);
      }
    }
    // else: external bank transfer — debit recorded below, shown as successful to user

    // 3. Record debit transaction for sender
    // External transfers show as "processing", internal as "completed"
    const txStatus = recipientAccount ? "completed" : "processing";
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        id:               uuidv4(),
        user_id:          req.user!.id,
        account_id:       body.from_account_id,
        type:             "debit",
        status:           txStatus,
        amount:           -(totalDebit),
        currency:         body.from_currency,
        description:      body.description,
        reference:        referenceDR,
        recipient_name:   body.recipient_name,
        recipient_account: body.to_account_number,
        category:         "Transfer",
      })
      .select()
      .single();

    if (txErr) throw new AppError(txErr.message, 500);

    // Return the base reference (without -DR suffix) for the receipt
    return successResponse(res, { transaction: tx, reference, fee }, "Transfer initiated", 201);
  } catch (err) {
    next(err);
  }
}

export async function exchange(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from_currency, to_currency, amount } = z.object({
      from_currency: z.string().length(3),
      to_currency:   z.string().length(3),
      amount:        z.number().positive(),
    }).parse(req.body);

    const fromRate = FX_RATES[from_currency] ?? 1;
    const toRate   = FX_RATES[to_currency]   ?? 1;
    const converted = (amount / fromRate) * toRate;

    return successResponse(res, {
      from: { currency: from_currency, amount },
      to:   { currency: to_currency,   amount: +converted.toFixed(6) },
      rate: +(toRate / fromRate).toFixed(6),
      fee:  0,
    }, "Exchange preview");
  } catch (err) {
    next(err);
  }
}

export async function getFxRates(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    return successResponse(res, {
      base: "USD",
      rates: FX_RATES,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

export async function getPairRate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.params;
    const fromRate = FX_RATES[from.toUpperCase()];
    const toRate   = FX_RATES[to.toUpperCase()];
    if (!fromRate || !toRate) return errorResponse(res, "Unsupported currency pair", 400);
    return successResponse(res, { from, to, rate: +(toRate / fromRate).toFixed(6) });
  } catch (err) {
    next(err);
  }
}

export async function getPaymentHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("transactions")
      .select("*")
      .eq("user_id", req.user!.id)
      .in("type", ["debit", "transfer"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new AppError(error.message, 500);
    return successResponse(res, data ?? []);
  } catch (err) {
    next(err);
  }
}

export async function cancelPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { data, error } = await getSupabase()
      .from("transactions")
      .update({ status: "cancelled" })
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .eq("status", "pending")
      .select()
      .single();

    if (error || !data) return errorResponse(res, "Payment not found or cannot be cancelled", 404);
    return successResponse(res, data, "Payment cancelled");
  } catch (err) {
    next(err);
  }
}
