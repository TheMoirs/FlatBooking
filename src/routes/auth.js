const express = require('express');
const { query } = require('../db');
const {
  isAdminEmail,
  hashPassword,
  checkPassword,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
} = require('../auth');

const router = express.Router();

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
    'SELECT id, name, email, phone, role, password_hash FROM users WHERE email = $1',
    [normalisedEmail]
  );
  const user = result.rows[0];

  if (!user || !(await checkPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  delete user.password_hash;
  setSessionCookie(res, user);
  res.json({ user });
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', attachUser, (req, res) => {
  if (!req.user) return res.status(401).json({ user: null });
  const { id, name, email, role } = req.user;
  res.json({ user: { id, name, email, role } });
});

module.exports = router;
