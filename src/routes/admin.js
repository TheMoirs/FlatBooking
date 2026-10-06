const express = require('express');
const { query } = require('../db');
const { attachUser, requireAdmin } = require('../auth');
const { fetchExternalBusyRanges, deriveGoogleCalendarIdFromUrl, checkGoogleCalendarWriteAccess, deleteGoogleCalendarEvent } = require('../calendarSync');

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

/* ---------------- User management ---------------- */

router.get('/users', attachUser, requireAdmin, async (req, res) => {
  const result = await query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.blocked, u.created_at,
            (u.password_hash IS NOT NULL) AS has_password,
            (u.google_id IS NOT NULL) AS has_google,
            (u.apple_id IS NOT NULL) AS has_apple,
            (u.facebook_id IS NOT NULL) AS has_facebook,
            (SELECT COUNT(*)::int FROM bookings b WHERE b.user_id = u.id) AS booking_count
     FROM users u
     ORDER BY lower(u.name), u.id`
  );
  res.json({ users: result.rows });
});

async function findUser(id) {
  const r = await query('SELECT id, name, email, role, blocked FROM users WHERE id = $1', [id]);
  return r.rows[0] || null;
}

router.put('/users/:id', attachUser, requireAdmin, async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const { name, email, phone, role } = req.body || {};
  if (!name || !String(name).trim() || !email || !String(email).trim() || !phone || !String(phone).trim()) {
    return res.status(400).json({ error: 'Name, email and phone are all required.' });
  }
  if (role !== 'user' && role !== 'admin') {
    return res.status(400).json({ error: 'Role must be user or admin.' });
  }
  const normalisedEmail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalisedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (user.id === req.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'You can’t remove your own admin access.' });
  }
  const clash = await query('SELECT id FROM users WHERE email = $1 AND id <> $2', [normalisedEmail, user.id]);
  if (clash.rows.length) {
    return res.status(409).json({ error: 'Another account already uses that email.' });
  }

  const result = await query(
    `UPDATE users SET name = $1, email = $2, phone = $3, role = $4 WHERE id = $5
     RETURNING id, name, email, phone, role, blocked`,
    [String(name).trim(), normalisedEmail, String(phone).trim(), role, user.id]
  );
  res.json({ user: result.rows[0] });
});

async function setBlocked(req, res, blocked) {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (blocked && user.id === req.user.id) {
    return res.status(400).json({ error: 'You can’t block your own account.' });
  }
  await query('UPDATE users SET blocked = $1 WHERE id = $2', [blocked, user.id]);
  res.json({ user: { ...user, blocked } });
}
router.post('/users/:id/block', attachUser, requireAdmin, (req, res) => setBlocked(req, res, true));
router.post('/users/:id/unblock', attachUser, requireAdmin, (req, res) => setBlocked(req, res, false));

// Deleting someone also deletes their bookings (the database cascades), so
// when they have any the request has to say so explicitly (?with_bookings=1);
// their Google Calendar events are removed first so none are left behind.
router.delete('/users/:id', attachUser, requireAdmin, async (req, res) => {
  const user = await findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'You can’t delete your own account.' });
  }

  const bookings = await query('SELECT id, google_event_id FROM bookings WHERE user_id = $1', [user.id]);
  if (bookings.rows.length && req.query.with_bookings !== '1') {
    return res.status(409).json({
      error: `${user.name} has ${bookings.rows.length} booking${bookings.rows.length === 1 ? '' : 's'}. Deleting them will delete those bookings too.`,
      booking_count: bookings.rows.length,
      needs_booking_confirmation: true,
    });
  }

  let calendarFailures = 0;
  for (const b of bookings.rows) {
    if (b.google_event_id) {
      const ok = await deleteGoogleCalendarEvent(b.google_event_id);
      if (!ok) calendarFailures += 1;
    }
  }

  await query('UPDATE settings SET updated_by = NULL WHERE updated_by = $1', [user.id]);
  await query('DELETE FROM users WHERE id = $1', [user.id]);

  res.json({
    deleted: true,
    deleted_bookings: bookings.rows.length,
    google_calendar_warning: calendarFailures
      ? `${calendarFailures} Google Calendar event${calendarFailures === 1 ? '' : 's'} couldn’t be removed — please delete ${calendarFailures === 1 ? 'it' : 'them'} from the calendar by hand.`
      : null,
  });
});

module.exports = router;
