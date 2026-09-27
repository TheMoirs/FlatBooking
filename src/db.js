const { Pool, types } = require('pg');

// By default node-postgres parses SQL DATE columns (oid 1082) into JS Date
// objects at local midnight. Anything downstream that then calls
// .toISOString() converts that instant to UTC, which silently shifts the
// date backwards by one day whenever the server's local timezone is ahead
// of UTC (e.g. Europe/London on BST) — bookings created for, say, 28 Sept
// would come back out of the database as 27 Sept. Dates have no time
// component, so we keep them as the plain 'YYYY-MM-DD' string Postgres
// sends instead of letting pg convert them to a Date at all.
types.setTypeParser(types.builtins.DATE, (value) => value);

if (!process.env.DATABASE_URL) {
  console.warn(
    'Warning: DATABASE_URL is not set. Copy .env.example to .env and fill it in ' +
    'with your Neon connection string before the API will work.'
  );
}

// SSL is controlled explicitly below via the `ssl` option, so a `sslmode=`
// query param in the connection string (Neon's URLs include one by default)
// is redundant — and it's what triggers pg's "SSL modes 'prefer', 'require',
// and 'verify-ca' are treated as aliases..." deprecation warning on every
// startup. Stripping it here silences that noise without changing anything
// about how we actually connect.
function withoutSslModeParam(connectionString) {
  if (!connectionString) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch (err) {
    // Not a parseable URL (e.g. malformed) — leave it as-is and let `pg`
    // surface whatever error it would have anyway.
    return connectionString;
  }
}

const pool = new Pool({
  connectionString: withoutSslModeParam(process.env.DATABASE_URL),
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = { pool, query: (text, params) => pool.query(text, params) };
