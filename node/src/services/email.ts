/**
 * Email service — powered by Google Apps Script (GmailApp).
 * All emails are sent from evergreenworldbank@gmail.com via the deployed Web App.
 * Script URL is stored in GOOGLE_SCRIPT_URL env var.
 */

const SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL ?? "";

if (!SCRIPT_URL) {
  console.warn("[email] GOOGLE_SCRIPT_URL not set — emails will fail");
}

/**
 * Core POST function — sends a JSON payload to the Google Apps Script Web App.
 * The script handles all email rendering and delivery via GmailApp.
 */
async function callScript(payload: Record<string, unknown>): Promise<void> {
  if (!SCRIPT_URL) throw new Error("GOOGLE_SCRIPT_URL is not configured");

  const res = await fetch(SCRIPT_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "no body");
    throw new Error(`Google Script responded ${res.status}: ${text}`);
  }

  const json = await res.json().catch(() => ({}));
  if (json.success === false) {
    throw new Error(`Google Script error: ${json.error ?? "unknown"}`);
  }
}

/** Send password reset OTP */
export async function sendPasswordResetOtp(toEmail: string, otp: string): Promise<void> {
  await callScript({ type: "password_reset", to: toEmail, otp });
}

/** Send payment PIN reset OTP */
export async function sendPinResetOtp(toEmail: string, otp: string): Promise<void> {
  await callScript({ type: "pin_reset", to: toEmail, otp });
}

/** Send credit alert to recipient */
export async function sendCreditAlert(params: {
  toEmail:              string;
  senderName:           string;
  amount:               number;
  fromCurrency:         string;
  toCurrency:           string;
  toAmount:             number;
  reference:            string;
  description:          string;
  transferType:         "local" | "international";
  date:                 string;
  recipientNewBalance?: number;
  recipientCurrency?:   string;
}): Promise<void> {
  const {
    toEmail, senderName, amount, fromCurrency,
    toCurrency, toAmount, reference, description,
    transferType, date, recipientNewBalance, recipientCurrency,
  } = params;

  const isIntl     = transferType === "international";
  const amountStr  = `${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${fromCurrency}`;
  const receiveStr = isIntl && toCurrency !== fromCurrency
    ? `${toAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${toCurrency}`
    : amountStr;

  await callScript({
    type:                 "credit_alert",
    to:                   toEmail,
    senderName,
    amountStr,
    receiveStr,
    reference,
    description,
    transferType,
    date:                 new Date(date).toLocaleString(),
    recipientNewBalance:  recipientNewBalance !== undefined
      ? `${recipientNewBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      : undefined,
    recipientCurrency,
  });
}
