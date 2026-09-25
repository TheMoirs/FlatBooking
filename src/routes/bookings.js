const express = require('express');
const { query } = require('../db');
const { attachUser, requireAuth, requireAdmin } = require('../auth');
const {
  fetchExternalBusyRanges,
  upsertGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  deriveGoogleEventIdFromUid,
} = require('../calendarSync');

const router = express.Router();

// end_date is the checkout day and is exclusive — someone can leave in the
// morning and a different guest can arrive that same afternoon, so the
// checkout day itself isn't treated as blocked. Two bookings overlap
// whenever one starts before the other ends, on both sides.
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
    id: b.id,
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
          const { status, guestName: cleanSummary } = parseExternalSummary(r.summary);
          const description = formatExternalDescription({
            summary: cleanSummary,
            status,
            details: r.description,
          });
          ranges.push({
            start: r.start,
            end: r.end,
            status,
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

// GET /api/bookings — the current user's own bookings, or (with ?all=1 and
// admin role) everyone's. For the user's own bookings, by default only ones
// that are still current or in the future are returned (end_date today or
// later); pass ?includeOld=1 to also get past ones — this backs the "Show
// old bookings" checkbox in the dashboard's "My bookings" tab. "All
// bookings" (the admin tab) has no such filter — it always returns the
// complete history, oldest first.
router.get('/bookings', attachUser, requireAuth, async (req, res) => {
  const wantsAll = req.query.all === '1';
  const includeOld = req.query.includeOld === '1';
  const today = todayStr();
  if (wantsAll && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access only.' });
  }

  if (!wantsAll) {
    const result = await query(
      `SELECT id, start_date, end_date, status, who_going, notes, created_at, source,
              arrival_time, departure_time,
              master_bedroom_config, middle_bedroom_config, first_bedroom_config
       FROM bookings WHERE user_id = $1 AND ($2::boolean OR end_date >= $3)
       ORDER BY start_date DESC`,
      [req.user.id, includeOld, today]
    );
    return res.json({ bookings: result.rows });
  }

  // "All bookings" is always the complete record — past, current and future
  // — with no filter toggle, so admins have one place that shows everything.
  const dbResult = await query(
    `SELECT b.id, b.start_date, b.end_date, b.status, b.who_going, b.notes, b.created_at, b.source,
            b.arrival_time, b.departure_time,
            b.master_bedroom_config, b.middle_bedroom_config, b.first_bedroom_config,
            u.name AS guest_name, u.email AS guest_email, u.phone AS guest_phone,
            b.calendar_description
     FROM bookings b JOIN users u ON u.id = b.user_id
     ORDER BY b.start_date ASC`
  );

  // Auto-import: any event on the linked Google Calendar that doesn't
  // already correspond to a non-cancelled booking in the app becomes one,
  // so "All bookings" is a complete picture without an admin having to
  // re-enter things that were booked directly on the calendar.
  let calendarSyncError = null;
  const settingsResult = await query('SELECT google_calendar_url FROM settings WHERE id = 1');
  const calendarUrl = settingsResult.rows[0] && settingsResult.rows[0].google_calendar_url;
  if (calendarUrl) {
    try {
      const [external, activeRanges] = await Promise.all([
        fetchExternalBusyRanges(calendarUrl),
        query(`SELECT start_date, end_date FROM bookings WHERE status <> 'cancelled'`),
      ]);
      const existingRanges = activeRanges.rows;
      const importFailures = [];

      for (const r of external) {
        // A same-day or zero/negative-length range (e.g. a timed, non-all-day
        // calendar entry like a reminder, which collapses to one date once
        // truncated to a date-only string) isn't a flat stay and would
        // violate the bookings table's end_date > start_date check — skip it
        // rather than let one odd calendar entry break the whole sync.
        if (!(r.start < r.end)) continue;

        // Only import current & future stays — a past calendar event that
        // was never booked through the app isn't worth adding retroactively.
        if (r.end < today) continue;

        const alreadyInApp = existingRanges.some((b) => b.start_date === r.start && b.end_date === r.end);
        if (alreadyInApp) continue;

        const { status, guestName } = parseExternalSummary(r.summary);
        const googleEventId = deriveGoogleEventIdFromUid(r.uid);
        const calendarDescription = formatExternalDescription({ summary: guestName, status, details: r.description });

        try {
          const inserted = await query(
            `INSERT INTO bookings (
               user_id, start_date, end_date, status, who_going, notes, calendar_description,
               source, external_guest_name, google_event_id
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_calendar', $8, $9)
             RETURNING id, start_date, end_date, status, who_going, notes, created_at, source`,
            [req.user.id, r.start, r.end, status, guestName, r.description || null, calendarDescription, guestName, googleEventId]
          );

          // Keep the in-memory "already exists" list in sync in case the same
          // event appears more than once in this pass (defensive).
          existingRanges.push({ start_date: r.start, end_date: r.end });

          const row = inserted.rows[0];
          dbResult.rows.push({
            ...row,
            arrival_time: null,
            departure_time: null,
            master_bedroom_config: null,
            middle_bedroom_config: null,
            first_bedroom_config: null,
            guest_name: guestName,
            guest_email: '',
            guest_phone: '',
            calendar_description: calendarDescription,
          });
        } catch (err) {
          // One malformed/unimportable calendar event shouldn't take down
          // the rest of the sync or the whole "All bookings" list.
          importFailures.push(`${guestName} (${r.start} → ${r.end}): ${err.message}`);
        }
      }

      if (importFailures.length) {
        calendarSyncError = `${importFailures.length} calendar event(s) couldn't be imported — ${importFailures.join('; ')}`;
      }
    } catch (err) {
      // Keep the DB bookings visible even if the external feed is temporarily unavailable.
      calendarSyncError = err.message;
    }
  }

  dbResult.rows.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));

  res.json({ bookings: dbResult.rows, calendar_sync_error: calendarSyncError });
});

// POST /api/bookings — logged-in guests propose a date range; starts as "provisional".
router.post('/bookings', attachUser, requireAuth, async (req, res) => {
  const {
    start_date,
    end_date,
    who_going,
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
  if (!who_going || !String(who_going).trim()) {
    return res.status(400).json({ error: 'Who’s going? is required.' });
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

  const whoGoing = String(who_going).trim();
  const calendarDescription = buildCalendarDescription({
    whoGoing,
    status: 'provisional',
    notes,
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
  });

  const result = await query(
    `INSERT INTO bookings (
       user_id, start_date, end_date, status, who_going,
       arrival_time, departure_time,
       master_bedroom_config, middle_bedroom_config, first_bedroom_config,
       notes, calendar_description
     ) VALUES ($1, $2, $3, 'provisional', $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id, start_date, end_date, status, who_going, notes, calendar_description, created_at`,
    [
      req.user.id,
      start_date,
      end_date,
      whoGoing,
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
    guestName: whoGoing || guest.rows[0]?.name || 'Guest',
    status: 'provisional',
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
    notes,
  });

  const googleCalendarUpdated = Boolean(eventId);
  if (eventId) {
    await query('UPDATE bookings SET google_event_id = $1 WHERE id = $2', [eventId, booking.id]);
    booking.google_event_id = eventId;
  }

  res.status(201).json({
    booking,
    google_calendar_updated: googleCalendarUpdated,
    google_calendar_warning: googleCalendarUpdated ? null : 'Booking saved, but Google Calendar update was blocked. Add the service account as an Editor on the shared calendar.',
  });
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
      guestName: row.who_going || row.guest_name,
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

// PUT /api/bookings/:id — the booking's own guest, or any admin, can edit its
// details (dates, who's going, arrival/leave, bedroom configs, notes).
// Editing doesn't change status — that's still done via authorise/cancel.
router.put('/bookings/:id', attachUser, requireAuth, async (req, res) => {
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Booking not found.' });
  const current = existing.rows[0];
  if (current.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only edit your own bookings.' });
  }

  const {
    start_date,
    end_date,
    who_going,
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
  if (!who_going || !String(who_going).trim()) {
    return res.status(400).json({ error: 'Who’s going? is required.' });
  }
  if (start_date >= end_date) {
    return res.status(400).json({ error: 'The checkout date must be after the check-in date.' });
  }

  const others = await query(
    `SELECT start_date, end_date FROM bookings WHERE status <> 'cancelled' AND id <> $1
     AND start_date < $3 AND end_date > $2`,
    [req.params.id, start_date, end_date]
  );
  const clash = others.rows.some((b) =>
    overlaps(start_date, end_date, toDateOnlyValue(b.start_date), toDateOnlyValue(b.end_date))
  );
  if (clash) {
    return res.status(409).json({ error: 'Those dates overlap with an existing booking. Please pick another range.' });
  }

  const whoGoing = String(who_going).trim();
  const calendarDescription = buildCalendarDescription({
    whoGoing,
    status: current.status,
    notes,
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
  });

  const result = await query(
    `UPDATE bookings SET
       start_date = $2, end_date = $3, who_going = $4,
       arrival_time = $5, departure_time = $6,
       master_bedroom_config = $7, middle_bedroom_config = $8, first_bedroom_config = $9,
       notes = $10, calendar_description = $11
     WHERE id = $1
     RETURNING id, start_date, end_date, status, who_going, notes, calendar_description, google_event_id, created_at`,
    [
      req.params.id,
      start_date,
      end_date,
      whoGoing,
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
  const eventId = await upsertGoogleCalendarEvent({
    eventId: booking.google_event_id || null,
    startDate: start_date,
    endDate: end_date,
    guestName: whoGoing,
    status: booking.status,
    arrivalTime: arrival_time,
    departureTime: departure_time,
    masterBedroomConfig: master_bedroom_config,
    middleBedroomConfig: middle_bedroom_config,
    firstBedroomConfig: first_bedroom_config,
    notes,
  });

  const googleCalendarUpdated = Boolean(eventId);
  if (eventId && eventId !== booking.google_event_id) {
    await query('UPDATE bookings SET google_event_id = $1 WHERE id = $2', [eventId, booking.id]);
    booking.google_event_id = eventId;
  }

  res.json({
    booking,
    google_calendar_updated: googleCalendarUpdated,
    google_calendar_warning: googleCalendarUpdated
      ? null
      : 'Booking updated, but Google Calendar update was blocked. Add the service account as an Editor on the shared calendar.',
  });
});

// POST /api/bookings/:id/cancel — the booking's own guest, or any admin, can
// cancel it. Cancelling removes the booking from Google Calendar and then
// deletes it outright — there's no "cancelled" state left lingering in the
// app afterwards.
router.post('/bookings/:id/cancel', attachUser, requireAuth, async (req, res) => {
  const existing = await query('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'Booking not found.' });
  const booking = existing.rows[0];
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only cancel your own bookings.' });
  }

  let googleCalendarRemoved = true;
  if (booking.google_event_id) {
    googleCalendarRemoved = await deleteGoogleCalendarEvent(booking.google_event_id);
  }

  // Delete the booking either way — a Google Calendar hiccup shouldn't block
  // removing it from the app; the warning below tells the admin to clean up
  // the calendar event by hand if that happened.
  await query('DELETE FROM bookings WHERE id = $1', [req.params.id]);

  res.json({
    deleted: true,
    booking_id: Number(req.params.id),
    google_calendar_removed: googleCalendarRemoved,
    google_calendar_warning: googleCalendarRemoved
      ? null
      : 'Booking removed from the app, but removing it from Google Calendar failed. Check the server logs and remove the event manually if needed.',
  });
});

// Today's date as 'YYYY-MM-DD' in the server's local timezone (via Intl,
// so it reflects the actual calendar day where this app runs rather than
// UTC — the same local/UTC mismatch caused the earlier date bug, so this
// deliberately never touches toISOString()).
function todayStr() {
  return new Date().toLocaleDateString('en-CA');
}

function addMonths(dateStr, n) {
  // Stay in UTC throughout — mixing a local setter like setMonth() with
  // toISOString()'s UTC output is the same class of bug that caused the
  // earlier off-by-one-day date issue.
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + n);
  return dt.toISOString().slice(0, 10);
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
  whoGoing,
  status,
  notes,
  arrivalTime,
  departureTime,
  masterBedroomConfig,
  middleBedroomConfig,
  firstBedroomConfig,
}) {
  const lines = [];
  if (whoGoing && String(whoGoing).trim()) {
    lines.push(`${labelStatus(status)} - ${String(whoGoing).trim()}`);
  }
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
    return direct;
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

// Google Calendar events written by this app carry a "Confirmed - <name>" or
// "Provisional - <name>" summary (see upsertGoogleCalendarEvent). Splitting
// that back out lets an event created directly on the calendar (not through
// the app) still come back with a sensible status and guest name.
function parseExternalSummary(rawSummary) {
  const summary = (rawSummary || 'External booking').trim();
  const match = summary.match(/^(Confirmed|Provisional)\s*[-:]\s*(.*)$/i);
  const status = match ? match[1].toLowerCase() : 'confirmed';
  const guestName = (match ? match[2].trim() : summary) || 'Google Calendar guest';
  return { status, guestName };
}

function formatExternalDescription({ summary, status, details }) {
  const base = summary ? `${labelStatus(status)} - ${summary}` : labelStatus(status);
  const detailsText = details && String(details).trim();
  if (!detailsText) return base;
  return `${base}\n${detailsText}`;
}

module.exports = router;
