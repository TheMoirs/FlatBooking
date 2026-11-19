// The two guest guides — "Directions & opening up" and "Closing down &
// heading home". Their text lives in the database, not in this (public)
// code, because it includes the flat's address and Wi-Fi password, and it
// is only ever sent to people who are logged in. Admins edit it in Settings.
const express = require('express');
const { query } = require('../db');
const { attachUser, requireAuth, requireAdmin } = require('../auth');

const router = express.Router();

const MAX_BODY = 50000; // characters — plenty for a page of notes

router.get('/guides/:slug', attachUser, requireAuth, async (req, res) => {
  const r = await query('SELECT slug, title, body, updated_at FROM guides WHERE slug = $1', [req.params.slug]);
  if (!r.rows[0]) return res.status(404).json({ error: "That guide doesn't exist." });
  res.json(r.rows[0]);
});

router.get('/admin/guides', attachUser, requireAdmin, async (req, res) => {
  const r = await query('SELECT slug, title, body, updated_at FROM guides ORDER BY slug DESC');
  res.json({ guides: r.rows });
});

router.put('/admin/guides/:slug', attachUser, requireAdmin, async (req, res) => {
  const body = String((req.body && req.body.body) || '');
  if (body.length > MAX_BODY) return res.status(400).json({ error: 'That guide is too long.' });
  const r = await query(
    'UPDATE guides SET body = $1, updated_at = NOW() WHERE slug = $2 RETURNING slug, title, body, updated_at',
    [body, req.params.slug]
  );
  if (!r.rows[0]) return res.status(404).json({ error: "That guide doesn't exist." });
  res.json(r.rows[0]);
});

module.exports = router;
