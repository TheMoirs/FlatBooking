-- Mirador de Calahonda booking site — Postgres schema
-- Run once against your Neon database, e.g.:
--   psql "$DATABASE_URL" -f schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL, -- exclusive, i.e. the checkout day (matches iCal DTEND convention)
  status       TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'confirmed', 'cancelled')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorised_by INTEGER REFERENCES users(id),
  authorised_at TIMESTAMPTZ,
  CHECK (end_date > start_date)
);

CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings (start_date, end_date) WHERE status <> 'cancelled';

-- Single-row settings table (admin-editable): where the linked calendar lives.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_calendar_url TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          INTEGER REFERENCES users(id)
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
