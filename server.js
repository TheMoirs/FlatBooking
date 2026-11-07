require('dotenv').config();
require('express-async-errors'); // lets thrown errors in async route handlers reach the error handler below
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./src/routes/auth');
const bookingRoutes = require('./src/routes/bookings');
const adminRoutes = require('./src/routes/admin');
const { pool } = require('./src/db');

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: true, credentials: true }));

app.use('/api/auth', authRoutes);
app.use('/api', bookingRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(path.join(__dirname, 'public')));

// Simple error handler so a thrown DB/API error becomes JSON, not an HTML stack trace.
// Must be registered last.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

// Brings the database up to date with schema.sql on every start — every
// statement in it is safe to re-run — so new columns appear on Render
// without anyone having to run `npm run migrate` by hand.
async function applySchema() {
  if (!process.env.DATABASE_URL) return;
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(sql);
    console.log('Database schema is up to date.');
  } catch (err) {
    console.error('Could not apply schema.sql:', err.message);
  }
}

const port = process.env.PORT || 3000;
applySchema().finally(() => {
  app.listen(port, () => {
    console.log(`Mirador de Calahonda booking site running on port ${port}`);
  });
});
