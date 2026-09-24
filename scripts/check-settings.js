require('dotenv').config();
const { Pool } = require('pg');
const { checkGoogleCalendarWriteAccess, deriveGoogleCalendarIdFromUrl } = require('../src/calendarSync');

(async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
  });

  const res = await pool.query('SELECT google_calendar_url, google_calendar_id, updated_at FROM settings WHERE id = 1');
  console.log('settings row:', JSON.stringify(res.rows, null, 2));
  if (res.rows[0]?.google_calendar_url) {
    console.log('derived id:', deriveGoogleCalendarIdFromUrl(res.rows[0].google_calendar_url));
  }
  const status = await checkGoogleCalendarWriteAccess();
  console.log('calendar status:', JSON.stringify(status, null, 2));
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
