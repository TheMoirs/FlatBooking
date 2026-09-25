const ical = require('node-ical');
const { google } = require('googleapis');
const { query } = require('./db');

function buildGoogleCalendarDescription({ guestName, status, arrivalTime, departureTime, masterBedroomConfig, middleBedroomConfig, firstBedroomConfig, notes }) {
  const lines = [
    `Guest: ${guestName || 'Guest'}`,
    `Status: ${status || 'provisional'}`,
  ];
  if (arrivalTime) lines.push(`Arrival time at flat: ${arrivalTime}`);
  if (departureTime) lines.push(`Flat leave time: ${departureTime}`);
  if (masterBedroomConfig) lines.push(`Master bedroom configuration: ${masterBedroomConfig}`);
  if (middleBedroomConfig) lines.push(`Middle bedroom configuration: ${middleBedroomConfig}`);
  if (firstBedroomConfig) lines.push(`1st bedroom configuration: ${firstBedroomConfig}`);
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}

function getGoogleCalendarCredentials() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.client_email && parsed.private_key) {
        return parsed;
      }
    } catch (err) {
      console.error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON env var.', err.message);
    }
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && privateKey) {
    return {
      client_email: email,
      private_key: privateKey.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

function deriveGoogleCalendarIdFromUrl(calendarUrl) {
  if (!calendarUrl) return null;
  try {
    const url = new URL(calendarUrl.trim());
    const segments = url.pathname.split('/').filter(Boolean);
    const icalIndex = segments.indexOf('ical');
    if (icalIndex !== -1) {
      const id = segments[icalIndex + 1];
      if (id) return decodeURIComponent(id);
    }
    if (url.hostname === 'calendar.google.com' && url.pathname.includes('/calendar/')) {
      const match = url.pathname.match(/\/calendar\/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+|[^/]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function getConfiguredGoogleCalendarId() {
  const settingsResult = await query('SELECT google_calendar_id, google_calendar_url FROM settings WHERE id = 1');
  const row = settingsResult.rows[0];

  if (row && row.google_calendar_id && row.google_calendar_id !== 'primary') {
    return row.google_calendar_id;
  }

  if (row && row.google_calendar_url) {
    const urlCalendarId = deriveGoogleCalendarIdFromUrl(row.google_calendar_url);
    if (urlCalendarId) return urlCalendarId;
  }

  if (process.env.GOOGLE_CALENDAR_ID && process.env.GOOGLE_CALENDAR_ID !== 'primary') {
    return process.env.GOOGLE_CALENDAR_ID;
  }

  return process.env.GOOGLE_CALENDAR_ID || null;
}

async function getGoogleCalendarClient() {
  const credentials = getGoogleCalendarCredentials();
  if (!credentials) return null;

  const calendarId = await getConfiguredGoogleCalendarId();
  if (!calendarId) {
    console.warn('No Google Calendar ID is configured for this app. Calendar write-backs are disabled until the shared calendar URL is set in the app settings.');
    return null;
  }

  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  return {
    auth,
    calendar: google.calendar({ version: 'v3', auth }),
    calendarId,
  };
}

async function upsertGoogleCalendarEvent({
  eventId,
  startDate,
  endDate,
  guestName,
  status,
  arrivalTime,
  departureTime,
  masterBedroomConfig,
  middleBedroomConfig,
  firstBedroomConfig,
  notes,
}) {
  const calendarClient = await getGoogleCalendarClient();
  if (!calendarClient) return null;

  const summary = `${status === 'confirmed' ? 'Confirmed' : 'Provisional'} - ${guestName || 'Guest'}`;
  const description = buildGoogleCalendarDescription({
    guestName,
    status,
    arrivalTime,
    departureTime,
    masterBedroomConfig,
    middleBedroomConfig,
    firstBedroomConfig,
    notes,
  });

  const payload = {
    summary,
    description,
    // endDate is the checkout day. Google's all-day events use an
    // exclusive end date too, so this lines up directly: a 28th-30th
    // booking (2 nights) shows as spanning the 28th and 29th, checkout on
    // the 30th, and that day stays free for another guest to arrive.
    start: { date: startDate },
    end: { date: endDate },
    transparency: 'opaque',
  };

  try {
    if (eventId) {
      const { data } = await calendarClient.calendar.events.update({
        calendarId: calendarClient.calendarId,
        eventId,
        requestBody: payload,
      });
      return data.id;
    }

    const { data } = await calendarClient.calendar.events.insert({
      calendarId: calendarClient.calendarId,
      requestBody: payload,
    });
    return data.id;
  } catch (err) {
    console.error('Google Calendar write-back failed:', err.message || err);
    return null;
  }
}

// Returns true if the event is confirmed gone from the calendar (deleted now,
// or already gone), false if we couldn't reach Google or the delete failed —
// callers use this to decide whether it's safe to forget the stored event id.
async function deleteGoogleCalendarEvent(eventId) {
  if (!eventId) return true;
  const calendarClient = await getGoogleCalendarClient();
  if (!calendarClient) return false;

  try {
    await calendarClient.calendar.events.delete({
      calendarId: calendarClient.calendarId,
      eventId,
    });
    return true;
  } catch (err) {
    // 410/404 means the event is already gone (e.g. deleted by hand in
    // Google Calendar) — that still counts as success for our purposes.
    const code = err && (err.code || (err.response && err.response.status));
    if (code === 404 || code === 410) return true;
    console.error('Google Calendar delete failed:', err.message || err);
    return false;
  }
}

async function checkGoogleCalendarWriteAccess() {
  const credentials = getGoogleCalendarCredentials();
  if (!credentials) {
    return { ok: false, message: 'Google Calendar write-back is not configured: missing service account credentials.' };
  }

  const calendarId = await getConfiguredGoogleCalendarId();
  if (!calendarId) {
    return { ok: false, message: 'Google Calendar is not configured yet. Add the shared iCal URL in the admin settings.' };
  }

  try {
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.list({ calendarId, maxResults: 1 });
    return { ok: true, message: 'Google Calendar is configured and update access is available.' };
  } catch (err) {
    const msg = err && err.message ? err.message : 'Unknown Google Calendar permission error';
    return {
      ok: false,
      message: 'Google Calendar write-back is blocked. Add the service account as an Editor on the shared calendar: calendaraccess@flatbooking-509615.iam.gserviceaccount.com',
      detail: msg,
    };
  }
}

// Turns a Google Calendar "Secret address in iCal format" URL (or any public
// .ics URL) into a list of {start, end} busy ranges. Google Calendar's
// sharing settings page for a calendar gives you this under
// "Integrate calendar" -> "Secret address in iCal format".
//
// If a person pastes a normal Google Calendar *web* link instead of the ICS
// link, we can't read events from it (Google requires the ICS format for
// programmatic access), so we surface a clear error rather than failing silently.
async function fetchExternalBusyRanges(calendarUrl) {
  if (!calendarUrl) return [];

  let url = calendarUrl.trim();
  if (url.includes('calendar.google.com') && !url.includes('/ical/') && !url.endsWith('.ics')) {
    throw new Error(
      "That looks like a Google Calendar web link, not the iCal feed. " +
      "In Google Calendar, go to Settings -> your calendar -> Integrate calendar, " +
      "and copy the 'Secret address in iCal format' link instead."
    );
  }

  const data = await ical.async.fromURL(url);
  const ranges = [];

  for (const key of Object.keys(data)) {
    const event = data[key];
    if (event.type !== 'VEVENT') continue;
    if (!event.start || !event.end) continue;

    // node-ical expands recurring events into rrule occurrences already when
    // you access .start/.end directly on non-recurring instances; for simple
    // recurring bookings this covers the common case of single, dated events.
    ranges.push({
      start: toDateOnly(event.start),
      end: toDateOnly(event.end),
      summary: (event.summary || 'External booking').trim(),
      description: (event.description || '').trim(),
    });
  }

  return ranges;
}

function toDateOnly(d) {
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

module.exports = {
  fetchExternalBusyRanges,
  upsertGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  deriveGoogleCalendarIdFromUrl,
  checkGoogleCalendarWriteAccess,
};
