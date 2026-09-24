const ical = require('node-ical');
const { google } = require('googleapis');

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

function getGoogleCalendarClient() {
  const credentials = getGoogleCalendarCredentials();
  if (!credentials) return null;

  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) {
    console.warn('GOOGLE_CALENDAR_ID is not set for this app. Calendar write-backs are disabled until it is configured in the app settings.');
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
    start: { date: startDate },
    end: { date: endDate },
    transparency: 'opaque',
  };

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
}

async function deleteGoogleCalendarEvent(eventId) {
  if (!eventId) return;
  const calendarClient = await getGoogleCalendarClient();
  if (!calendarClient) return;

  await calendarClient.calendar.events.delete({
    calendarId: calendarClient.calendarId,
    eventId,
  });
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

module.exports = { fetchExternalBusyRanges, upsertGoogleCalendarEvent, deleteGoogleCalendarEvent };
