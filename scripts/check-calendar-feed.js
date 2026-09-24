require('dotenv').config();
const { fetchExternalBusyRanges } = require('../src/calendarSync');

(async () => {
  const url = 'https://calendar.google.com/calendar/ical/b7hqe4k0utt3m473nshmf4l128%40group.calendar.google.com/private-4ee507d64522d443e0ed2ecf4f1ca920/basic.ics';
  try {
    const ranges = await fetchExternalBusyRanges(url);
    console.log(JSON.stringify({ count: ranges.length, ranges: ranges.slice(0, 10) }, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exit(1);
  }
})();
