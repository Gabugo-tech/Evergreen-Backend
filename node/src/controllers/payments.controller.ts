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
      .select("id, balance, available_balance, currency")
      .eq("id", body.from_account_id)
      .eq("user_id", req.user!.id)
      .single();

    if (accErr || !account) return errorResponse(res, "Account not found", 404);

    const balance          = typeof account.balance === "string" ? parseFloat(account.balance) : Number(account.balance);
    const availableBalance = typeof account.available_balance === "string" ? parseFloat(account.available_balance) : Number(account.available_balance ?? account.balance);

    const fee = body.transfer_type === "international" ? 2.5 : 0;

    // Convert the send amount + fee into the account's native currency so
    // the balance check is always an apples-to-apples comparison.
    const accountCurrency = (account.currency as string).toUpperCase();
    const fromCurrencyUC  = body.from_currency.toUpperCase();
    const accountRate     = FX_RATES[accountCurrency] ?? 1;
    const fromRate        = FX_RATES[fromCurrencyUC]  ?? 1;
    const conversionRatio = accountRate / fromRate;

    const amountInAccountCurrency = body.amount * conversionRatio;
    const feeInAccountCurrency    = fee         * conversionRatio;
    const totalDebit              = amountInAccountCurrency + feeInAccountCurrency;

    console.log(
      `[sendMoney] balance=${balance} ${accountCurrency} | ` +
      `send=${body.amount} ${fromCurrencyUC} → ${amountInAccountCurrency.toFixed(4)} ${accountCurrency} | ` +
      `fee=${fee} → ${feeInAccountCurrency.toFixed(4)} ${accountCurrency} | ` +
      `totalDebit=${totalDebit.toFixed(4)} | type=${body.transfer_type}`
    );

    // Bug fix #1: only block local transfers for insufficient funds.
    // International transfers are allowed to proceed regardless of balance.
    if (body.transfer_type === "local" && balance < totalDebit) {
      console.log(`[sendMoney] INSUFFICIENT: balance(${balance}) < totalDebit(${totalDebit.toFixed(4)})`);
      return errorResponse(res, "Insufficient balance", 422);
    }

    // Generate collision-proof references using UUID segments
    const baseRef     = uuidv4().replace(/-/g, "").slice(0, 16).toUpperCase();
    const reference   = `EG${baseRef}`;
    const referenceCR = `${reference}CR`; // credit leg
    const referenceDR = `${reference}DR`; // debit leg

    // 1. Debit sender — subtract totalDebit (already in the account's currency)
    //    and keep available_balance in sync.
    const newBalance          = balance          - totalDebit;
    const newAvailableBalance = availableBalance - totalDebit;
    const { error: debitErr } = await supabase
      .from("bank_accounts")
      .update({ balance: newBalance, available_balance: newAvailableBalance })
      .eq("id", body.from_account_id);

    if (debitErr) throw new AppError(debitErr.message, 500);

    // 2. Credit recipient if they have an Evergreen account.
    //    For external banks the debit is recorded and shown as processing —
    //    actual settlement would go through a banking API in production.
    const { data: recipientAccount } = await supabase
      .from("bank_accounts")
      .select("id, balance, available_balance, currency, user_id")
      .eq("account_number", body.to_account_number)
      .maybeSingle();

    if (recipientAccount) {
      // Bug fix #2: convert the credit amount into the recipient account's own
      // currency — not the sender's from_currency.
      const recipientCurrency = (recipientAccount.currency as string).toUpperCase();
      const recipientRate     = FX_RATES[recipientCurrency] ?? 1;
      // amount (in from_currency) → USD → recipient currency
      const creditAmount = (body.amount / fromRate) * recipientRate;

      const recipientBalance          = typeof recipientAccount.balance === "string" ? parseFloat(recipientAccount.balance) : Number(recipientAccount.balance);
      const recipientAvailableBalance = typeof recipientAccount.available_balance === "string" ? parseFloat(recipientAccount.available_balance) : Number(recipientAccount.available_balance ?? recipientAccount.balance);

      await supabase
        .from("bank_accounts")
        .update({
          balance:           recipientBalance          + creditAmount,
          available_balance: recipientAvailableBalance + creditAmount,
        })
        .eq("id", recipientAccount.id);

      try {
        await supabase
          .from("transactions")
          .insert({
            id:                uuidv4(),
            user_id:           recipientAccount.user_id,
            account_id:        recipientAccount.id,
            type:              "credit",
            status:            "completed",
            amount:            creditAmount,          // stored in recipient's currency
            currency:          recipientCurrency,
            description:       body.description,
            reference:         referenceCR,
            recipient_name:    body.recipient_name,
            recipient_account: body.to_account_number,
            category:          "Transfer",
          });
      } catch (creditErr) {
        console.warn("[sendMoney] Credit transaction insert failed:", creditErr);
      }
    }

    // 3. Record debit transaction for the sender.
    //    Bug fix #3: store body.amount in from_currency (what the user typed),
    //    NOT totalDebit which is already converted to the account's currency.
    //    The fee is stored separately so the receipt can display it correctly.
    const txStatus = recipientAccount ? "completed" : "processing";
    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .insert({
        id:                uuidv4(),
        user_id:           req.user!.id,
        account_id:        body.from_account_id,
        type:              "debit",
        status:            txStatus,
        amount:            -(body.amount),   // what the user sent, in from_currency
        currency:          fromCurrencyUC,
        description:       body.description,
        reference:         referenceDR,
        recipient_name:    body.recipient_name,
        recipient_account: body.to_account_number,
        category:          "Transfer",
      })
      .select()
      .single();

    if (txErr) throw new AppError(txErr.message, 500);

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
      .in("type", ["debit", "credit", "transfer"])
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
    // Allow cancellation of both "pending" and "processing" transactions —
    // internal transfers land as "completed" immediately, but external ones
    // are set to "processing" and are still cancellable before settlement.
    const { data, error } = await getSupabase()
      .from("transactions")
      .update({ status: "cancelled" })
      .eq("id", req.params.id)
      .eq("user_id", req.user!.id)
      .in("status", ["pending", "processing"])
      .select()
      .single();

    if (error || !data) return errorResponse(res, "Payment not found or cannot be cancelled", 404);
    return successResponse(res, data, "Payment cancelled");
  } catch (err) {
    next(err);
  }
}
