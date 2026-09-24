require('dotenv').config();
const { fetchExternalBusyRanges } = require('./src/calendarSync');
const { query } = require('./src/db');

(async () => {
  const res = await query('SELECT google_calendar_url FROM settings WHERE id = 1');
  const url = res.rows[0] && res.rows[0].google_calendar_url;
  console.log('URL=', url);
  if (!url) { console.log('NO URL'); return; }
  try {
    const rows = await fetchExternalBusyRanges(url);
    console.log('ROWS=', rows.length);
    console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  } catch (err) {
    console.error('ERR', err.message);
    process.exitCode = 1;
  }
})();
