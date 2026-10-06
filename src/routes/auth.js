const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { query } = require('../db');
const {
  isAdminEmail,
  hashPassword,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  promoteIfAdminEmail,
  signPendingGoogleSignup,
  verifyPendingGoogleSignup,
  signPendingSocialSignup,
  verifyPendingSocialSignup,
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

/* ---------------- Continue with Apple / Facebook ----------------
   Each is only switched on when its keys are set on the server (see
   /social-config) — otherwise the buttons simply don't appear. Instagram
   isn't offered: Meta no longer provides a "log in with Instagram" for
   ordinary personal accounts (Facebook login covers the same people). */

const SOCIAL_COLUMNS = { apple: 'apple_id', facebook: 'facebook_id' };

router.get('/social-config', (req, res) => {
  res.json({
    apple_client_id: process.env.APPLE_CLIENT_ID || null,
    apple_redirect_uri: process.env.APPLE_REDIRECT_URI || null,
    facebook_app_id: process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET ? process.env.FACEBOOK_APP_ID : null,
  });
});

async function verifyFacebookAccessToken(accessToken) {
  const appId = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  const dbgRes = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(`${appId}|${secret}`)}`
  );
  const dbg = await dbgRes.json();
  if (!dbg.data || !dbg.data.is_valid || String(dbg.data.app_id) !== String(appId)) {
    throw new Error('invalid facebook token');
  }
  const meRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`
  );
  const me = await meRes.json();
  if (!me || !me.id) throw new Error('no facebook profile');
  return { providerId: String(me.id), email: me.email ? String(me.email).trim().toLowerCase() : null, name: me.name || null };
}

async function verifyAppleIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header || !decoded.header.kid) throw new Error('bad apple token');
  const jwksRes = await fetch('https://appleid.apple.com/auth/keys');
  const jwks = await jwksRes.json();
  const jwk = (jwks.keys || []).find((k) => k.kid === decoded.header.kid);
  if (!jwk) throw new Error('unknown apple key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const payload = jwt.verify(idToken, key, {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    audience: process.env.APPLE_CLIENT_ID,
  });
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  return { providerId: String(payload.sub), email: payload.email && verified ? String(payload.email).trim().toLowerCase() : null };
}

// Shared by Apple and Facebook once the provider has vouched for an identity:
// log in an account we already know (by provider id, or by the same email,
// linking the two), or ask for a phone number to create a new one.
async function finishSocialSignIn(res, provider, { providerId, email, name }) {
  const column = SOCIAL_COLUMNS[provider];
  const label = provider === 'apple' ? 'Apple' : 'Facebook';
  if (!email) {
    return res.status(400).json({
      error: `${label} didn’t share a verified email address with us, so we can’t set up your account that way. Please use another sign-in option.`,
    });
  }

  let row = (await query(`SELECT id, name, email, phone, role, blocked FROM users WHERE ${column} = $1`, [providerId])).rows[0];
  if (!row) {
    row = (await query('SELECT id, name, email, phone, role, blocked FROM users WHERE email = $1', [email])).rows[0];
    if (row && !row.blocked) {
      await query(`UPDATE users SET ${column} = $1 WHERE id = $2`, [providerId, row.id]);
    }
  }
  if (row) {
    if (row.blocked) return res.status(403).json({ error: BLOCKED_MESSAGE });
    const { blocked, ...rest } = row;
    const user = await promoteIfAdminEmail(rest);
    setSessionCookie(res, user);
    return res.json({ user });
  }

  const displayName = (name && String(name).trim()) || email;
  const pendingToken = signPendingSocialSignup({ provider, providerId, email, name: displayName });
  res.json({ needs_phone: true, pending_token: pendingToken, name: displayName, email });
}

router.post('/facebook', async (req, res) => {
  if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
    return res.status(503).json({ error: 'Facebook sign-in is not configured on this server.' });
  }
  const { access_token: accessToken } = req.body || {};
  if (!accessToken) return res.status(400).json({ error: 'Missing Facebook token.' });
  let identity;
  try {
    identity = await verifyFacebookAccessToken(accessToken);
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify that Facebook sign-in — please try again.' });
  }
  await finishSocialSignIn(res, 'facebook', identity);
});

router.post('/apple', async (req, res) => {
  if (!process.env.APPLE_CLIENT_ID) {
    return res.status(503).json({ error: 'Apple sign-in is not configured on this server.' });
  }
  const { id_token: idToken, name } = req.body || {};
  if (!idToken) return res.status(400).json({ error: 'Missing Apple token.' });
  let identity;
  try {
    identity = await verifyAppleIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Could not verify that Apple sign-in — please try again.' });
  }
  // Apple only sends the person's name the very first time, via the browser.
  await finishSocialSignIn(res, 'apple', { ...identity, name });
});

router.post('/social/complete', async (req, res) => {
  const { pending_token: pendingToken, phone } = req.body || {};
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }
  let pending;
  try {
    pending = verifyPendingSocialSignup(pendingToken);
  } catch (err) {
    return res.status(401).json({ error: 'That sign-up has expired — please start again.' });
  }
  const column = SOCIAL_COLUMNS[pending.provider];
  if (!column) return res.status(400).json({ error: 'Unknown sign-in provider.' });

  const existing = await query(`SELECT id FROM users WHERE email = $1 OR ${column} = $2`, [pending.email, pending.providerId]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'An account already exists for that email — try logging in instead.' });
  }
  const role = isAdminEmail(pending.email) ? 'admin' : 'user';
  const result = await query(
    `INSERT INTO users (name, email, phone, password_hash, ${column}, role)
     VALUES ($1, $2, $3, NULL, $4, $5)
     RETURNING id, name, email, phone, role`,
    [pending.name, pending.email, String(phone).trim(), pending.providerId, role]
  );
  const user = result.rows[0];
  setSessionCookie(res, user);
  res.status(201).json({ user });
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
