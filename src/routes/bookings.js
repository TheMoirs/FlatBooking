const express = require('express');
const { query } = require('../db');
const { attachUser, requireAuth, requireAdmin } = require('../auth');
const { fetchExternalBusyRanges } = require('../calendarSync');

const router = express.Router();

// Ranges overlap if one starts before the other ends, on both sides.
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Public — no login required. Returns every busy range (our own bookings
// that are provisional or confirmed, plus anything on the linked external
// calendar) so the homepage calendar can shade booked vs available dates.
router.get('/availability', async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10);
  const to = req.query.to || addMonths(from, 6);

  const internal = await query(
    `SELECT id, start_date, end_date, status FROM bookings
     WHERE status <> 'cancelled' AND start_date < $2 AND end_date > $1
     ORDER BY start_date`,
    [from, to]
  );

  const ranges = internal.rows.map((b) => ({
    start: b.start_date.toISOString().slice(0, 10),
    end: b.end_date.toISOString().slice(0, 10),
    status: b.status,
    source: 'flat',
  }));

  const settingsResult = await query('SELECT google_calendar_url FROM settings WHERE id = 1');
  const calendarUrl = settingsResult.rows[0] && settingsResult.rows[0].google_calendar_url;

  let externalError = null;
  if (calendarUrl) {
    try {
      const external = await fetchExternalBusyRanges(calendarUrl);
      for (const r of external) {
        if (r.start < to && r.end > from) {
          ranges.push({ start: r.start, end: r.end, status: 'confirmed', source: 'google-calendar' });
        }
      }
    } catch (err) {
      externalError = err.message;
    }
  }

  res.json({ ranges, externalCalendarConnected: Boolean(calendarUrl), externalError });
});

// GET /api/bookings — the current user's own bookings, or (with ?all=1 and admin role) everyone's.
router.get('/', attachUser, requireAuth, async (req, res) => {
  const wantsAll = req.query.all === '1';
  if (wantsAll && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only.' });
  }

  const result = wantsAll
    ? await query(
        `SELECT b.id, b.start_date, b.end_date, b.status, b.notes, b.created_at,
                u.name AS guest_name, u.email AS guest_email, u.phone AS guest_phone
         FROM bookings b JOIN users u ON u.id = b.user_id
         ORDER BY b.start_date DESC`
      )
    : await query(
        `SELECT id, start_date, end_date, status, notes, created_at
         FROM bookings WHERE user_id = $1 ORDER BY start_date DESC`,
        [req.user.id]
      );

  res.json({ bookings: result.rows });
});

// POST /api/bookings — logged-in guests propose a date range; starts as "provisional".
router.post('/', attachUser, requireAuth, async (req, res) => {
  const { start_date, end_date, notes } = req.body || {};
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Start and end dates are required.' });
  }
  if (start_date >= end_date) {
    return res.status(400).json({ error: 'The checkout date must be after the check-in date.' });
  }

  const existing = await query(
    `SELECT start_date, end_date FROM bookings WHERE status <> 'cancelled'
     AND start_date < $2 AND end_date > $1`,
    [start_date, end_date]
  );
  const clash = existing.rows.some((b) =>
    overlaps(start_date, end_date, b.start_date.toISOString().slice(0, 10), b.end_date.toISOString().slice(0, 10))
  );
  if (clash) {
    return res.status(409).json({ error: 'Those dates overlap with an existing booking. Please pick another range.' });
  }

  const result = await query(
    `INSERT INTO bookings (user_id, start_date, end_date, notes, status)
     VALUES ($1, $2, $3, $4, 'provisional')
     RETURNING id, start_date, end_date, status, notes, created_at`,
    [req.user.id, start_date, end_date, notes || null]
  );

  res.status(201).json({ booking: result.rows[0] });
});

// POST /api/bookings/:id/authorise — admin confirms a provisional booking.
router.post('/:id/authorise', attachUser, requireAdmin, async (req, res) => {
  const result = await query(
    `UPDATE bookings SET status = 'confirmed', authorised_by = $2, authorised_at = now()
     WHERE id = $1 RETURNING id, start_date, end_date, status`,
    [req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ booking: result.rows[0] });
});

// POST /api/bookings/:id/cancel — the booking's own guest, or any admin, can cancel it.
router.post('/:id/cancel', attachUser, requireAuth, async (req, res) => {
  const existing = await query('SELECT user_id FROM bookings WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Booking not found.' });
  if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only cancel your own bookings.' });
  }

  const result = await query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1
     RETURNING id, start_date, end_date, status`,
    [req.params.id]
  );
  res.json({ booking: result.rows[0] });
});

function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = router;
