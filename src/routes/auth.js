const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../db');
const { sendMail } = require('../mailer');
const {
  isAdminEmail,
  hashPassword,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  promoteIfAdminEmail,
  verifyPasswordReset,
  resetFingerprint,
  resetUrl,
  signPendingGoogleSignup,
  verifyPendingGoogleSignup,
} = require('../auth');

const BLOCKED_MESSAGE = 'This account has been blocked. Please contact Ali or Dawn.';

const router = express.Router();

// A Google OAuth 2.0 "Web application" client id — public, not secret; it's
// the same one the frontend passes to Google Identity Services to get a
// sign-in button, and is checked again here as the expected audience on the
// ID token it hands back, so a token minted for some other app can't be
// replayed against this one.
const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

// GET /api/auth/google-client-id — public. Lets the frontend render the
// Google sign-in button without the client id being hardcoded into the
// static HTML/JS, the same way the rest of this app keeps configuration in
// environment variables rather than checked-in files.
router.get('/google-client-id', (req, res) => {
  res.json({ client_id: process.env.GOOGLE_CLIENT_ID || null });
});

router.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body || {};

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'Name, email, phone and password are all required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const normalisedEmail = String(email).trim().toLowerCase();

  const existing = await query('SELECT id FROM users WHERE email = $1', [normalisedEmail]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account already exists for that email — try logging in instead.' });
  }

  const passwordHash = await hashPassword(password);
  const role = isAdminEmail(normalisedEmail) ? 'admin' : 'user';

  const result = await query(
    `INSERT INTO users (name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, phone, role`,
    [name.trim(), normalisedEmail, phone.trim(), passwordHash, role]
  );

  const user = result.rows[0];
  setSessionCookie(res, user);
  res.status(201).json({ user });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalisedEmail = String(email).trim().toLowerCase();
  const result = await query(
    'SELECT id, name, email, phone, role, blocked, password_hash FROM users WHERE email = $1',
    [normalisedEmail]
  );
  const user = result.rows[0];

  // No password_hash means this account was created with "Continue with
  // Google" and has never set a password — bcrypt can't compare against
  // null, and there's nothing to match anyway.
  if (!user || !user.password_hash || !(await checkPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  if (user.blocked) {
    return res.status(403).json({ error: BLOCKED_MESSAGE });
  }

  delete user.password_hash;
  delete user.blocked;
  const loggedIn = await promoteIfAdminEmail(user);
  setSessionCookie(res, loggedIn);
  res.json({ user: loggedIn });
});

// POST /api/auth/google — body: { credential } (the ID token Google
// Identity Services hands back after someone picks an account). Logs them
// straight in if we already know this Google account or this email;
// otherwise this is a new sign-up, and since Google doesn't hand over a
// phone number, it stops short of creating the account and asks the
// frontend to collect one first (see /google/complete below).
router.post('/google', async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential.' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify that Google sign-in — please try again.' });
  }

  if (!payload || !payload.email_verified) {
    return res.status(401).json({ error: 'Your Google account email isn’t verified.' });
  }

  const googleId = payload.sub;
  const email = String(payload.email).trim().toLowerCase();
  const name = (payload.name && String(payload.name).trim()) || email;

  // Already linked to a Google account — straight in.
  const byGoogleId = await query(
    'SELECT id, name, email, phone, role, blocked FROM users WHERE google_id = $1',
    [googleId]
  );
  if (byGoogleId.rows.length) {
    const row = byGoogleId.rows[0];
    if (row.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE });
    const { blocked, ...rest } = row;
    const user = await promoteIfAdminEmail(rest);
    setSessionCookie(res, user);
    return res.json({ user });
  }

  // An existing password account with the same (Google-verified) email —
  // link this Google identity onto it rather than creating a duplicate.
  const byEmail = await query('SELECT id, name, email, phone, role, blocked FROM users WHERE email = $1', [email]);
  if (byEmail.rows.length) {
    const row = byEmail.rows[0];
    if (row.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE });
    const { blocked, ...rest } = row;
    await query('UPDATE users SET google_id = $1 WHERE id = $2', [googleId, rest.id]);
    const user = await promoteIfAdminEmail(rest);
    setSessionCookie(res, user);
    return res.json({ user });
  }

  // Brand new — we have a verified name and email but no phone number, so
  // hand the frontend a short-lived token to bring back to /google/complete
  // along with one.
  const pendingToken = signPendingGoogleSignup({ googleId, email, name });
  res.json({ needs_phone: true, pending_token: pendingToken, name, email });
});

// POST /api/auth/google/complete — finishes a new "Continue with Google"
// sign-up once the frontend has collected a phone number. pending_token is
// the one /google just issued, carrying the already-verified Google
// identity — the phone number is the only thing actually coming from the
// request body here.
router.post('/google/complete', async (req, res) => {
  const { pending_token: pendingToken, phone } = req.body || {};
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  let pending;
  try {
    pending = verifyPendingGoogleSignup(pendingToken);
  } catch (err) {
    return res.status(401).json({ error: 'That sign-up has expired — please start again with Google.' });
  }

  const existing = await query('SELECT id FROM users WHERE email = $1 OR google_id = $2', [pending.email, pending.googleId]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account already exists for that email — try logging in instead.' });
  }

  const role = isAdminEmail(pending.email) ? 'admin' : 'user';
  const result = await query(
    `INSERT INTO users (name, email, phone, password_hash, google_id, role)
     VALUES ($1, $2, $3, NULL, $4, $5)
     RETURNING id, name, email, phone, role`,
    [pending.name, pending.email, String(phone).trim(), pending.googleId, role]
  );

  const user = result.rows[0];
  setSessionCookie(res, user);
  res.status(201).json({ user });
});

// POST /api/auth/forgot — emails a reset link. Always answers the same way so
// it can't be used to find out which emails have accounts.
router.post('/forgot', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Please enter your email address.' });
  const r = await query('SELECT id, name, email, password_hash, blocked FROM users WHERE email = $1', [email]);
  const user = r.rows[0];
  if (user && !user.blocked) {
    const link = resetUrl(req, user);
    try {
      const sent = await sendMail({
        to: user.email,
        subject: 'Reset your Casa Moir password',
        text: `Hi ${user.name.split(' ')[0]},\n\nUse this link to choose a new password (it works for one hour):\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
      });
      if (!sent) console.warn('Password reset requested but email is not configured (RESEND_API_KEY / MAIL_FROM).');
    } catch (err) {
      console.error(err.message);
    }
  }
  res.json({ ok: true });
});

// POST /api/auth/reset — body { token, password }
router.post('/reset', async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const expired = { error: 'That reset link has expired or already been used — please request a new one.' };
  let payload;
  try { payload = verifyPasswordReset(token); } catch (e) { return res.status(400).json(expired); }
  const r = await query('SELECT id, name, email, phone, role, blocked, password_hash FROM users WHERE id = $1', [payload.id]);
  const user = r.rows[0];
  if (!user || resetFingerprint(user) !== payload.fp) return res.status(400).json(expired);
  if (user.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE });
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), user.id]);
  const { password_hash, blocked, ...rest } = user;
  const loggedIn = await promoteIfAdminEmail(rest);
  setSessionCookie(res, loggedIn);
  res.json({ user: loggedIn });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', attachUser, (req, res) => {
  if (req.blocked) return res.status(403).json({ user: null, error: BLOCKED_MESSAGE });
  if (!req.user) return res.status(401).json({ user: null });
  const { id, name, email, role } = req.user;
  res.json({ user: { id, name, email, role } });
});

module.exports = router;
