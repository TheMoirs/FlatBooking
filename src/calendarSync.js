const ical = require('node-ical');

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
    ranges.push({ start: toDateOnly(event.start), end: toDateOnly(event.end) });
  }

  return ranges;
}

function toDateOnly(d) {
  const date = new Date(d);
  return date.toISOString().slice(0, 10);
}

module.exports = { fetchExternalBusyRanges };
