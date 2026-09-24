require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

(async () => {
  const users = await pool.query('SELECT id, name, email, role FROM users ORDER BY id');
  const bookings = await pool.query(
    'SELECT id, user_id, start_date, end_date, status, calendar_description FROM bookings ORDER BY start_date'
  );
  const settings = await pool.query('SELECT id, google_calendar_url, updated_at FROM settings ORDER BY id');
  console.log(JSON.stringify({ users: users.rows, bookings: bookings.rows, settings: settings.rows }, null, 2));
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
