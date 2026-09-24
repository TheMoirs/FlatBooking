const express = require('express');
const { query } = require('../db');
const { attachUser, requireAuth, requireAdmin } = require('../auth');
const { fetchExternalBusyRanges, upsertGoogleCalendarEvent, deleteGoogleCalendarEvent } = require('../calendarSync');

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
    `SELECT b.id, b.start_date, b.end_date, b.status, u.name AS guest_name,
            b.arrival_time, b.departure_time, b.master_bedroom_config,
            b.middle_bedroom_config, b.first_bedroom_config, b.notes, b.calendar_description
     FROM bookings b
     JOIN users u ON u.id = b.user_id
     WHERE b.status <> 'cancelled' AND b.start_date < $2 AND b.end_date > $1
     ORDER BY b.start_date`,
    [from, to]
  );

  const ranges = internal.rows.map((b) => ({
    start: toDateOnlyValue(b.start_date),
    end: toDateOnlyValue(b.end_date),
    status: b.status,
    description: formatBookingDescription({
      guestName: b.guest_name,
      status: b.status,
      arrivalTime: b.arrival_time,
      departureTime: b.departure_time,
      masterBedroomConfig: b.master_bedroom_config,
      middleBedroomConfig: b.middle_bedroom_config,
      firstBedroomConfig: b.first_bedroom_config,
      notes: b.notes,
      calendarDescription: b.calendar_description,
    }),
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
          const summary = (r.summary || 'External booking').replace(/^Confirmed\s*-\s*/i, '').trim();
          const description = formatExternalDescription({
            summary,
            status: 'confirmed',
            details: r.description,
          });
          ranges.push({
            start: r.start,
            end: r.end,
            status: 'confirmed',
            description,
            source: 'google-calendar',
          });
        }
      }
    } catch (err) {
      externalError = err.message;
    }
  }

  res.json({ ranges, externalCalendarConnected: Boolean(calendarUrl), externalError });
});

// GET /api/bookings — the current user's own bookings, or (with ?all=1 and admin role) everyone's.
router.get('/bookings', attachUser, requireAuth, async (req, res) => {
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
router.post('/bookings', attachUser, requireAuth, async (req, res) => {
  const {
    start_date,
    end_date,
    notes,
    arrival_time,
    departure_time,
    master_bedroom_config,
    middle_bedroom_config,
    first_bedroom_config,
  } = req.body || {};
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
    overlaps(start_date, end_date, toDateOnlyValue(b.start_date), toDateOnlyValue(b.end_date))
  );
  if (clash) {
    return res.status(409).json({ error: 'Those dates overlap with an existing booking. Please pick another range.' });
  }

  const calendarDescription = buildCalendarDescription({
    notes,
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
  });

  const result = await query(
    `INSERT INTO bookings (
       user_id, start_date, end_date, status,
       arrival_time, departure_time,
       master_bedroom_config, middle_bedroom_config, first_bedroom_config,
       notes, calendar_description
     ) VALUES ($1, $2, $3, 'provisional', $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, start_date, end_date, status, notes, calendar_description, created_at`,
    [
      req.user.id,
      start_date,
      end_date,
      arrival_time || null,
      departure_time || null,
      master_bedroom_config || null,
      middle_bedroom_config || null,
      first_bedroom_config || null,
      notes || null,
      calendarDescription || null,
    ]
  );

  const booking = result.rows[0];
  const guest = await query('SELECT name FROM users WHERE id = $1', [req.user.id]);
  const eventId = await upsertGoogleCalendarEvent({
    eventId: null,
    startDate: start_date,
    endDate: end_date,
    guestName: guest.rows[0]?.name || 'Guest',
    status: 'provisional',
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
    notes,
  });

  if (eventId) {
    await query('UPDATE bookings SET google_event_id = $1 WHERE id = $2', [eventId, booking.id]);
    booking.google_event_id = eventId;
  }

  res.status(201).json({ booking });
});

// POST /api/bookings/:id/authorise — admin confirms a provisional booking.
router.post('/bookings/:id/authorise', attachUser, requireAdmin, async (req, res) => {
  const current = await query(
    `SELECT b.*, u.name AS guest_name
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (!current.rows.length) return res.status(404).json({ error: 'Booking not found.' });

  const row = current.rows[0];
  const result = await query(
    `UPDATE bookings SET status = 'confirmed', authorised_by = $2, authorised_at = now()
     WHERE id = $1 RETURNING id, start_date, end_date, status, google_event_id`,
    [req.params.id, req.user.id]
  );

  if (result.rows[0]?.google_event_id) {
    await upsertGoogleCalendarEvent({
      eventId: result.rows[0].google_event_id,
      startDate: row.start_date,
      endDate: row.end_date,
      guestName: row.guest_name,
      status: 'confirmed',
      arrivalTime: row.arrival_time,
      departureTime: row.departure_time,
      masterBedroomConfig: row.master_bedroom_config,
      middleBedroomConfig: row.middle_bedroom_config,
      firstBedroomConfig: row.first_bedroom_config,
      notes: row.notes,
    });
  }

  res.json({ booking: result.rows[0] });
});

// POST /api/bookings/:id/cancel — the booking's own guest, or any admin, can cancel it.
router.post('/bookings/:id/cancel', attachUser, requireAuth, async (req, res) => {
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Booking not found.' });
  if (existing.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only cancel your own bookings.' });
  }

  const result = await query(
    `UPDATE bookings SET status = 'cancelled' WHERE id = $1
     RETURNING id, start_date, end_date, status, google_event_id`,
    [req.params.id]
  );

  if (result.rows[0]?.google_event_id) {
    await deleteGoogleCalendarEvent(result.rows[0].google_event_id);
  }

  res.json({ booking: result.rows[0] });
});

function addMonths(dateStr, n) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function toDateOnlyValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function labelStatus(status) {
  if (!status) return 'Booked';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildCalendarDescription({
  notes,
  arrivalTime,
  departureTime,
  masterBedroomConfig,
  middleBedroomConfig,
  firstBedroomConfig,
}) {
  const lines = [];
  if (arrivalTime) lines.push(`Arrival time at flat: ${arrivalTime}`);
  if (departureTime) lines.push(`Flat leave time: ${departureTime}`);
  if (masterBedroomConfig) lines.push(`Master bedroom: ${masterBedroomConfig}`);
  if (middleBedroomConfig) lines.push(`Middle bedroom: ${middleBedroomConfig}`);
  if (firstBedroomConfig) lines.push(`1st bedroom: ${firstBedroomConfig}`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}

function formatBookingDescription({
  guestName,
  status,
  arrivalTime,
  departureTime,
  masterBedroomConfig,
  middleBedroomConfig,
  firstBedroomConfig,
  notes,
  calendarDescription,
}) {
  const direct = calendarDescription && String(calendarDescription).trim();
  if (direct) {
    return `${labelStatus(status)} - ${guestName}\n${direct}`;
  }

  const lines = [`${labelStatus(status)} - ${guestName}`];
  if (arrivalTime) lines.push(`Arrival time: ${arrivalTime}`);
  if (departureTime) lines.push(`Leave time: ${departureTime}`);
  if (masterBedroomConfig) lines.push(`Master bedroom: ${masterBedroomConfig}`);
  if (middleBedroomConfig) lines.push(`Middle bedroom: ${middleBedroomConfig}`);
  if (firstBedroomConfig) lines.push(`1st bedroom: ${firstBedroomConfig}`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}

function formatExternalDescription({ summary, status, details }) {
  const base = summary ? `${labelStatus(status)} - ${summary}` : labelStatus(status);
  const detailsText = details && String(details).trim();
  if (!detailsText) return base;
  return `${base}\n${detailsText}`;
}

module.exports = router;
