// Sends email from ali@themoirs.co.uk (override with MAIL_FROM). Two ways, in
// order of preference:
//   1. Resend — RESEND_API_KEY, with themoirs.co.uk verified in Resend.
//              Use this on Render: it sends over HTTPS, and Render's free plan
//              blocks the SMTP ports (25, 465, 587).
//   2. SMTP  — SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT).
//              Only used when RESEND_API_KEY isn't set, e.g. running locally.
//              e.g. Google Workspace: smtp.gmail.com, ali@themoirs.co.uk + an app password.
// Returns true if sent, false if neither is configured.
const nodemailer = require('nodemailer');

const DEFAULT_FROM = 'Casa Moir <ali@themoirs.co.uk>';

async function sendMail({ to, subject, text }) {
  const from = process.env.MAIL_FROM || DEFAULT_FROM;

  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!r.ok) throw new Error('Email send failed: ' + r.status);
    return true;
  }

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

  return false;
}
module.exports = { sendMail };
