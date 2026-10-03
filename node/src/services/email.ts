import * as Brevo from "@getbrevo/brevo";

// ─── Validate env vars at startup ────────────────────────────────────────────
if (!process.env.BREVO_API_KEY) {
  console.warn("[email] BREVO_API_KEY not set — emails will fail");
}

// ─── Brevo API client ─────────────────────────────────────────────────────────
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(
  Brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY ?? ""
);

const FROM_EMAIL = process.env.BREVO_FROM_EMAIL ?? process.env.GMAIL_USER ?? "noreply@evergreen.com";
const FROM_NAME  = "Evergreen Bank";

// ─── Helper: send via Brevo HTTP API ─────────────────────────────────────────
async function send(to: string, subject: string, html: string, text: string): Promise<void> {
  const email = new Brevo.SendSmtpEmail();
  email.sender  = { name: FROM_NAME, email: FROM_EMAIL };
  email.to      = [{ email: to }];
  email.subject = subject;
  email.htmlContent = html;
  email.textContent = text;
  await apiInstance.sendTransacEmail(email);
}

// ─── Shared HTML wrapper ──────────────────────────────────────────────────────
function buildEmail(subtitle: string, bodyHtml: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
        .container { max-width: 520px; margin: 40px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; }
        .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 40px; text-align: center; }
        .header h1 { color: #fff; font-size: 24px; margin: 0; font-weight: 700; }
        .header p  { color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 14px; }
        .body  { padding: 36px 40px; }
        .otp-box { background: #0f172a; border: 2px solid #2563eb; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
        .otp  { font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #60a5fa; font-family: monospace; }
        .note { font-size: 13px; color: #94a3b8; margin-top: 8px; }
        .warning { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #fbbf24; margin-top: 20px; }
        .footer { padding: 20px 40px; border-top: 1px solid #334155; font-size: 12px; color: #475569; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🌿 Evergreen</h1>
          <p>${subtitle}</p>
        </div>
        <div class="body">${bodyHtml}</div>
        <div class="footer">© 2026 Evergreen Financial Limited · All rights reserved</div>
      </div>
    </body>
    </html>
  `;
}

function otpBody(message: string, otp: string): string {
  return `
    <p>${message}</p>
    <div class="otp-box">
      <div class="otp">${otp}</div>
      <div class="note">Expires in 15 minutes</div>
    </div>
    <div class="warning">⚠️ Never share this code with anyone. Evergreen staff will never ask for your OTP.</div>
    <p style="margin-top: 24px; font-size: 13px; color: #94a3b8;">
      If you did not request this, please ignore this email or contact support immediately.
    </p>
  `;
}

// ─── Password reset OTP ───────────────────────────────────────────────────────
export async function sendPasswordResetOtp(toEmail: string, otp: string): Promise<void> {
  const html = buildEmail("Reset your password", otpBody("You requested to reset your Evergreen account password. Use the code below:", otp));
  await send(
    toEmail,
    "Your Evergreen Password Reset Code",
    html,
    `Your Evergreen password reset code is: ${otp}\n\nThis code expires in 15 minutes.`
  );
}

// ─── Payment PIN reset OTP ────────────────────────────────────────────────────
export async function sendPinResetOtp(toEmail: string, otp: string): Promise<void> {
  const html = buildEmail("Reset your payment PIN", otpBody("You requested to reset your Evergreen payment PIN. Use the code below:", otp));
  await send(
    toEmail,
    "Your Evergreen Payment PIN Reset Code",
    html,
    `Your Evergreen payment PIN reset code is: ${otp}\n\nThis code expires in 15 minutes.`
  );
}

// ─── Credit alert (sent to recipient) ────────────────────────────────────────
export async function sendCreditAlert(params: {
  toEmail:       string;
  senderName:    string;
  amount:        number;
  fromCurrency:  string;
  toCurrency:    string;
  toAmount:      number;
  reference:     string;
  description:   string;
  transferType:  "local" | "international";
  date:          string;
}): Promise<void> {
  const { toEmail, senderName, amount, fromCurrency, toCurrency, toAmount, reference, description, transferType, date } = params;

  const isIntl     = transferType === "international";
  const amountStr  = `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${fromCurrency}`;
  const receiveStr = isIntl && toCurrency !== fromCurrency
    ? `${toAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${toCurrency}`
    : amountStr;

  const bodyHtml = `
    <p style="margin:0 0 20px;">You have received a transfer from <strong>${senderName}</strong> via Evergreen Bank.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#94a3b8;">Amount Sent</td>
        <td style="padding:10px 0;text-align:right;font-weight:600;color:#e2e8f0;">${amountStr}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#94a3b8;">Amount to Receive</td>
        <td style="padding:10px 0;text-align:right;font-weight:700;color:#60a5fa;font-size:18px;">${receiveStr}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#94a3b8;">From</td>
        <td style="padding:10px 0;text-align:right;font-weight:600;color:#e2e8f0;">${senderName}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#94a3b8;">Reference</td>
        <td style="padding:10px 0;text-align:right;font-family:monospace;color:#e2e8f0;">${reference}</td>
      </tr>
      <tr style="border-bottom:1px solid #334155;">
        <td style="padding:10px 0;color:#94a3b8;">Description</td>
        <td style="padding:10px 0;text-align:right;color:#e2e8f0;">${description}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;color:#94a3b8;">Date</td>
        <td style="padding:10px 0;text-align:right;color:#e2e8f0;">${new Date(date).toLocaleString()}</td>
      </tr>
    </table>
    ${isIntl
      ? `<div style="margin-top:20px;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:14px;font-size:13px;color:#94a3b8;">⏳ <strong style="color:#e2e8f0;">International Transfer:</strong> Funds typically arrive within 1–3 business days.</div>`
      : `<div style="margin-top:20px;background:#052e16;border:1px solid #166534;border-radius:8px;padding:14px;font-size:13px;color:#86efac;">✅ <strong>Local Transfer:</strong> This transfer has been processed and funds are on their way.</div>`
    }
  `;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
        .container { max-width: 520px; margin: 40px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; }
        .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 40px; text-align: center; }
        .header h1 { color: #fff; font-size: 24px; margin: 0; font-weight: 700; }
        .header p  { color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 14px; }
        .body  { padding: 36px 40px; }
        .footer { padding: 20px 40px; border-top: 1px solid #334155; font-size: 12px; color: #475569; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>🌿 Evergreen</h1><p>You've received a transfer</p></div>
        <div class="body">${bodyHtml}</div>
        <div class="footer">© 2026 Evergreen Financial Limited · Automated notification.</div>
      </div>
    </body>
    </html>
  `;

  await send(toEmail, `You've received ${receiveStr} from ${senderName}`, html,
    `You have received ${receiveStr} from ${senderName} via Evergreen Bank.\n\nReference: ${reference}\nDescription: ${description}\n\n${isIntl ? "Funds typically arrive within 1–3 business days." : "Funds have been processed."}`
  );
}
