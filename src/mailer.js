// Sends email through Resend (https://resend.com) using plain fetch — no extra
// dependency. Needs RESEND_API_KEY and MAIL_FROM (e.g. "Casa Moir <bookings@yourdomain>")
// on the server. Returns true if sent, false if email isn't configured.
async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if (!r.ok) throw new Error('Email send failed: ' + r.status);
  return true;
}
module.exports = { sendMail };
