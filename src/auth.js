const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('./db');

const COOKIE_NAME = 'mirador_session';
const SEVEN_DAYS = 60 * 60 * 24 * 7;

// These two are always admins, on top of anything set in the ADMIN_EMAILS
// environment variable (comma-separated) on the server.
const DEFAULT_ADMIN_EMAILS = ['ali@themoirs.co.uk', 'dawn@themoirs.co.uk'];

function adminEmails() {
  return DEFAULT_ADMIN_EMAILS.concat(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAdminEmail(email) {
  return adminEmails().includes((email || '').trim().toLowerCase());
}

function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

function checkPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signSession(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: SEVEN_DAYS }
  );
}

// A brand-new "Continue with Google" sign-up still needs a phone number —
// the one thing Google doesn't hand over — before the account can be
// created. Rather than trust whatever the browser sends back on that second
// step, the already-verified Google payload (id, email, name) gets packed
// into this short-lived token after the ID token check, and the completing
// request has to present it back. `purpose` keeps it from being usable
// anywhere a real session token is expected, or vice versa.
const PENDING_GOOGLE_SIGNUP_TTL = 60 * 10; // 10 minutes — just long enough to fill in a phone number
function signPendingGoogleSignup({ googleId, email, name }) {
  return jwt.sign(
    { purpose: 'google_signup', googleId, email, name },
    process.env.JWT_SECRET,
    { expiresIn: PENDING_GOOGLE_SIGNUP_TTL }
  );
}

function verifyPendingGoogleSignup(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== 'google_signup') throw new Error('Not a pending-signup token.');
  return payload;
}

// Same idea as the Google one above, for "Continue with Apple" / "Continue
// with Facebook": the provider-verified identity is packed into a short-lived
// token while the phone number is collected.
function signPendingSocialSignup({ provider, providerId, email, name }) {
  return jwt.sign(
    { purpose: 'social_signup', provider, providerId, email, name },
    process.env.JWT_SECRET,
    { expiresIn: PENDING_GOOGLE_SIGNUP_TTL }
  );
}

function verifyPendingSocialSignup(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  if (payload.purpose !== 'social_signup') throw new Error('Not a pending-signup token.');
  return payload;
}

function setSessionCookie(res, user) {
  const token = signSession(user);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// If this person's email is on the admin list but their account was created
// before that (or via a different sign-in route), make them an admin now.
// Returns the (possibly updated) user object.
async function promoteIfAdminEmail(user) {
  if (user && user.role !== 'admin' && isAdminEmail(user.email)) {
    await query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
    return { ...user, role: 'admin' };
  }
  return user;
}

// Attaches req.user if a valid session cookie is present; otherwise leaves it undefined.
// The role and blocked flag are read fresh from the database on every request
// (not trusted from the cookie), so promoting, demoting, blocking or deleting
// someone takes effect straight away, even if they're already logged in.
async function attachUser(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const r = await query('SELECT id, name, email, role, blocked FROM users WHERE id = $1', [payload.id]);
      let row = r.rows[0];
      if (row && row.blocked) {
        req.blocked = true;
      } else if (row) {
        row = await promoteIfAdminEmail(row);
        req.user = { id: row.id, email: row.email, role: row.role, name: row.name };
      }
    } catch (err) {
      // expired/invalid token or a database hiccup — treat as logged out
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.blocked) return res.status(403).json({ error: 'This account has been blocked. Please contact Ali or Dawn.' });
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.blocked) return res.status(403).json({ error: 'This account has been blocked. Please contact Ali or Dawn.' });
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  next();
}

module.exports = {
  COOKIE_NAME,
  isAdminEmail,
  hashPassword,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  promoteIfAdminEmail,
  requireAuth,
  requireAdmin,
  signPendingGoogleSignup,
  verifyPendingGoogleSignup,
  signPendingSocialSignup,
  verifyPendingSocialSignup,
};
