const express = require('express');
const { query } = require('../db');
const { attachUser, requireAdmin } = require('../auth');
const { fetchExternalBusyRanges, deriveGoogleCalendarIdFromUrl, checkGoogleCalendarWriteAccess } = require('../calendarSync');

const router = express.Router();

router.get('/settings', attachUser, requireAdmin, async (req, res) => {
  const result = await query(
    `SELECT google_calendar_url, google_calendar_id, daily_rate, cleaning_fee_1_room, cleaning_fee_2_rooms, updated_at
     FROM settings WHERE id = 1`
  );
  const settings = result.rows[0] || {};
  const calendarStatus = await checkGoogleCalendarWriteAccess();
  res.json({ settings, calendar_status: calendarStatus });
});

// A charge field is optional and nullable (an admin might not have filled
// it in yet), but if it IS sent it must be a non-negative number — this
// turns '', null and undefined all into null, and rejects anything else
// that doesn't parse as a plain number.
function parseCharge(value) {
  if (value === '' || value === null || value === undefined) return { ok: true, value: null };
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return { ok: false };
  return { ok: true, value: num };
}

router.put('/settings', attachUser, requireAdmin, async (req, res) => {
  const { google_calendar_url, daily_rate, cleaning_fee_1_room, cleaning_fee_2_rooms } = req.body || {};

  // Validate the link before saving it, so a typo doesn't silently break the
  // public calendar for everyone.
  if (google_calendar_url) {
    try {
      await fetchExternalBusyRanges(google_calendar_url);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  const dailyRate = parseCharge(daily_rate);
  const cleaning1 = parseCharge(cleaning_fee_1_room);
  const cleaning2 = parseCharge(cleaning_fee_2_rooms);
  if (!dailyRate.ok || !cleaning1.ok || !cleaning2.ok) {
    return res.status(400).json({ error: 'Charges must be plain numbers (or left blank).' });
  }

  const derivedCalendarId = deriveGoogleCalendarIdFromUrl(google_calendar_url);
  const result = await query(
    `UPDATE settings SET
       google_calendar_url = $1, google_calendar_id = $2,
       daily_rate = $3, cleaning_fee_1_room = $4, cleaning_fee_2_rooms = $5,
       updated_at = now(), updated_by = $6
     WHERE id = 1
     RETURNING google_calendar_url, google_calendar_id, daily_rate, cleaning_fee_1_room, cleaning_fee_2_rooms, updated_at`,
    [google_calendar_url || null, derivedCalendarId || null, dailyRate.value, cleaning1.value, cleaning2.value, req.user.id]
  );
  const calendarStatus = await checkGoogleCalendarWriteAccess();
  res.json({ settings: result.rows[0], calendar_status: calendarStatus });
});

module.exports = router;
