// Applies schema.sql to whatever DATABASE_URL points at. Run with: npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — copy .env.example to .env and fill it in first.');
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  try {
    await pool.query(sql);
    console.log('Schema applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
