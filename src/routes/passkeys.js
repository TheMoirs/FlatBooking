// Fingerprint / Face ID login, using passkeys (WebAuthn). The phone or
// laptop keeps a private key unlocked by the person's fingerprint, face or
// device PIN; we only ever store the matching public key, so there's no
// password to leak.
//
//   POST /api/auth/passkey/register/options  (logged in) → options for the browser
//   POST /api/auth/passkey/register/verify   (logged in) → saves the new passkey
//   POST /api/auth/passkey/login/options                 → options for the browser
//   POST /api/auth/passkey/login/verify                  → logs in
//
// A passkey belongs to the address it was made on (spain.themoirs.uk), so
// one made there won't work on flatbooking.onrender.com, and vice versa.
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { query } = require('../db');
const { attachUser, requireAuth, setSessionCookie, promoteIfAdminEmail, blockedMessage } = require('../auth');

const router = express.Router();

const RP_NAME = 'Casa Moir';
const CHALLENGE_COOKIE = 'mirador_passkey_challenge';
const CHALLENGE_TTL = 5 * 60; // seconds

// The site's own address as the browser sees it. The passkey is tied to the
// hostname (rpID), and the browser signs the exact origin, which has to
// match one of these.
function rpIdFor(req) {
  return req.hostname;
}
function expectedOrigins(req) {
  const host = req.get('host');
  return [`https://${host}`, `http://${host}`];
}

// The one-time challenge travels in a short-lived signed cookie rather than
// server memory, so it survives Render restarting the server mid-login.
function setChallenge(res, purpose, challenge, userId) {
  const token = jwt.sign({ purpose, challenge, userId: userId || null }, process.env.JWT_SECRET, { expiresIn: CHALLENGE_TTL });
  res.cookie(CHALLENGE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: CHALLENGE_TTL * 1000,
  });
}
function takeChallenge(req, res, purpose) {
  const token = req.cookies && req.cookies[CHALLENGE_COOKIE];
  res.clearCookie(CHALLENGE_COOKIE);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.purpose === purpose ? payload : null;
  } catch (e) {
    return null;
  }
}

function deviceLabel(req) {
  const ua = req.get('user-agent') || '';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Device';
}

router.post('/register/options', attachUser, requireAuth, async (req, res) => {
  const existing = await query('SELECT credential_id, transports FROM passkeys WHERE user_id = $1', [req.user.id]);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpIdFor(req),
    userName: req.user.email,
    userDisplayName: req.user.name,
    userID: new TextEncoder().encode(String(req.user.id)),
    attestationType: 'none',
    // Stops the same phone being set up twice.
    excludeCredentials: existing.rows.map((r) => ({ id: r.credential_id, transports: r.transports ? r.transports.split(',') : undefined })),
    authenticatorSelection: {
      // Built-in fingerprint / face / PIN, saved on the device so the login
      // button works without typing an email first.
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
  });
  setChallenge(res, 'register', options.challenge, req.user.id);
  res.json(options);
});

router.post('/register/verify', attachUser, requireAuth, async (req, res) => {
  const saved = takeChallenge(req, res, 'register');
  if (!saved || saved.userId !== req.user.id) {
    return res.status(400).json({ error: 'That took too long — please try again.' });
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge: saved.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: rpIdFor(req),
      requireUserVerification: true,
    });
  } catch (err) {
    return res.status(400).json({ error: `Couldn't set up fingerprint / Face ID: ${err.message}` });
  }
  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: "Couldn't set up fingerprint / Face ID. Please try again." });
  }
  const { credential } = verification.registrationInfo;
  await query(
    `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      req.user.id,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter || 0,
      (credential.transports || []).join(',') || null,
      deviceLabel(req),
    ]
  );
  res.json({ ok: true });
});

router.post('/login/options', async (req, res) => {
  // No email needed: the device offers whichever passkeys it holds for this site.
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(req),
    userVerification: 'required',
  });
  setChallenge(res, 'login', options.challenge);
  res.json(options);
});

router.post('/login/verify', async (req, res) => {
  const saved = takeChallenge(req, res, 'login');
  if (!saved) return res.status(400).json({ error: 'That took too long — please try again.' });

  const credentialId = req.body && req.body.id;
  const found = await query(
    `SELECT p.id AS passkey_id, p.credential_id, p.public_key, p.counter, p.transports,
            u.id, u.name, u.email, u.phone, u.role, u.blocked, u.pending_approval
     FROM passkeys p JOIN users u ON u.id = p.user_id
     WHERE p.credential_id = $1`,
    [credentialId]
  );
  const row = found.rows[0];
  if (!row) {
    return res.status(401).json({
      error: "This fingerprint / Face ID isn't set up for an account here any more. Please log in with your password, then set it up again.",
    });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: req.body,
      expectedChallenge: saved.challenge,
      expectedOrigin: expectedOrigins(req),
      expectedRPID: rpIdFor(req),
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: new Uint8Array(row.public_key),
        counter: Number(row.counter) || 0,
        transports: row.transports ? row.transports.split(',') : undefined,
      },
    });
  } catch (err) {
    return res.status(401).json({ error: `Couldn't log in with fingerprint / Face ID: ${err.message}` });
  }
  if (!verification.verified) {
    return res.status(401).json({ error: "Couldn't log in with fingerprint / Face ID." });
  }

  if (row.blocked) return res.status(403).json({ error: blockedMessage(row) });

  await query('UPDATE passkeys SET counter = $1, last_used_at = NOW() WHERE id = $2', [
    verification.authenticationInfo.newCounter || 0,
    row.passkey_id,
  ]);

  const user = await promoteIfAdminEmail({ id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role });
  setSessionCookie(res, user);
  res.json({ user });
});

module.exports = router;
