// Deletes every cancelled booking from the database.
//
// Usage:
//   node scripts/delete-cancelled-bookings.js          -> lists what WOULD be deleted (dry run)
//   node scripts/delete-cancelled-bookings.js --yes     -> actually deletes them
//
// This only touches rows with status = 'cancelled'. Cancelling a booking
// already removes its event from Google Calendar (see src/routes/bookings.js),
// so this just clears the leftover database rows/history — nothing else is
// affected.

require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

(async () => {
  const confirmed = process.argv.includes('--yes');

  const cancelled = await pool.query(
    `SELECT b.id, b.start_date, b.end_date, u.name AS guest_name
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.status = 'cancelled'
     ORDER BY b.start_date`
  );

  if (!cancelled.rows.length) {
    console.log('No cancelled bookings found. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`Found ${cancelled.rows.length} cancelled booking(s):`);
  cancelled.rows.forEach((b) => {
    console.log(`  #${b.id}  ${b.start_date} -> ${b.end_date}  ${b.guest_name}`);
  });

  if (!confirmed) {
    console.log('\nDry run only — nothing deleted. Re-run with --yes to actually delete these.');
    await pool.end();
    return;
  }

  const result = await pool.query(`DELETE FROM bookings WHERE status = 'cancelled'`);
  console.log(`\nDeleted ${result.rowCount} cancelled booking(s).`);
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
