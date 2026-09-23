const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.warn(
    'Warning: DATABASE_URL is not set. Copy .env.example to .env and fill it in ' +
    'with your Neon connection string before the API will work.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

module.exports = { pool, query: (text, params) => pool.query(text, params) };
