import nodemailer from "nodemailer";

// ─── Transporter (Gmail + App Password) ──────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// ─── Send PIN Reset OTP ───────────────────────────────────────────────────────
export async function sendPinResetOtp(toEmail: string, otp: string): Promise<void> {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
        .container { max-width: 480px; margin: 40px auto; background: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; }
        .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 40px; text-align: center; }
        .header h1 { color: #fff; font-size: 24px; margin: 0; font-weight: 700; }
        .header p { color: rgba(255,255,255,0.7); margin: 6px 0 0; font-size: 14px; }
        .body { padding: 36px 40px; }
        .otp-box { background: #0f172a; border: 2px solid #2563eb; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0; }
        .otp { font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #60a5fa; font-family: monospace; }
        .note { font-size: 13px; color: #94a3b8; margin-top: 8px; }
        .warning { background: #451a03; border: 1px solid #92400e; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #fbbf24; margin-top: 20px; }
        .footer { padding: 20px 40px; border-top: 1px solid #334155; font-size: 12px; color: #475569; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔐 Evergreen</h1>
          <p>Payment PIN Reset</p>
        </div>
        <div class="body">
          <p>You requested to reset your payment PIN. Use the code below to complete the process:</p>
          <div class="otp-box">
            <div class="otp">${otp}</div>
            <div class="note">Expires in 15 minutes</div>
          </div>
          <div class="warning">
            ⚠️ Never share this code with anyone. Evergreen staff will never ask for your OTP.
          </div>
          <p style="margin-top: 24px; font-size: 13px; color: #94a3b8;">
            If you did not request a PIN reset, please ignore this email or contact support immediately.
          </p>
        </div>
        <div class="footer">
          © 2026 Evergreen Financial Limited · All rights reserved
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"Evergreen Bank" <${process.env.GMAIL_USER}>`,
    to:   toEmail,
    subject: "Your Evergreen Payment PIN Reset Code",
    html,
    text: `Your Evergreen payment PIN reset code is: ${otp}\n\nThis code expires in 15 minutes.\n\nIf you did not request this, please ignore this email.`,
  });
}
