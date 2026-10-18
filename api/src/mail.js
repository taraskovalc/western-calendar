// Sending email (used for "Forgot your password?").
//
// Uses Resend (resend.com), an email service with a free tier and a simple
// web API, so no extra package is needed: it's one HTTPS request.
// Until RESEND_API_KEY and MAIL_FROM are set in .env, email is switched off and
// the reset feature tells people it isn't available yet.
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.MAIL_FROM;  // e.g. "Slotted <slotted@taraskoval.ca>"

export const mailEnabled = Boolean(API_KEY && FROM);

export async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  if (!mailEnabled) throw new Error('Email is not configured');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    // attachments: [{ filename, content (base64) }]. reply_to: where "Reply" goes.
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html, reply_to: replyTo, attachments }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Email service answered ${response.status}: ${await response.text()}`);
  }
}
