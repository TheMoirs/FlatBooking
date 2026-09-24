const express = require('express');
const { query } = require('../db');
const { attachUser, requireAdmin } = require('../auth');
const { fetchExternalBusyRanges } = require('../calendarSync');

const router = express.Router();

router.get('/settings', attachUser, requireAdmin, async (req, res) => {
  const result = await query('SELECT google_calendar_url, updated_at FROM settings WHERE id = 1');
  res.json({ settings: result.rows[0] || {} });
});

router.put('/settings', attachUser, requireAdmin, async (req, res) => {
  const { google_calendar_url } = req.body || {};

  // Validate the link before saving it, so a typo doesn't silently break the
  // public calendar for everyone.
  if (google_calendar_url) {
    try {
      await fetchExternalBusyRanges(google_calendar_url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const result = await query(
    `UPDATE settings SET google_calendar_url = $1, updated_at = now(), updated_by = $2
     WHERE id = 1 RETURNING google_calendar_url, updated_at`,
    [google_calendar_url || null, req.user.id]
  );
  res.json({ settings: result.rows[0] });
});

module.exports = router;
