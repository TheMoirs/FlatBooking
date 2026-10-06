// Sends email from ali@themoirs.co.uk (override with MAIL_FROM). Two ways, in
// order of preference:
//   1. SMTP  — SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT).
//              e.g. Google Workspace: smtp.gmail.com, ali@themoirs.co.uk + an app password.
//   2. Resend — RESEND_API_KEY, with themoirs.co.uk verified in Resend.
// Returns true if sent, false if neither is configured.
const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'Casa Moir <ali@themoirs.co.uk>';

async function sendMail({ to, subject, text }) {
  const from = process.env.MAIL_FROM || DEFAULT_FROM;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 465;
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({ from, to, subject, text });
    return true;
  }

  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!r.ok) throw new Error('Email send failed: ' + r.status);
    return true;
  }
  return false;
}
module.exports = { sendMail };
