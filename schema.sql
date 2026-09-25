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
  id                        SERIAL PRIMARY KEY,
  user_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL, -- the checkout day (stored exclusive, matching iCal DTEND, so end - start = nights stayed); treated as blocked for new bookings too — no same-day turnover
  status                    TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'confirmed', 'cancelled')),
  who_going                 TEXT,
  arrival_time              TEXT,
  departure_time            TEXT,
  master_bedroom_config     TEXT CHECK (master_bedroom_config IN ('Double', 'Twin Singles')),
  middle_bedroom_config     TEXT CHECK (middle_bedroom_config IN ('Double', 'Twin Singles', 'Not Required')),
  first_bedroom_config      TEXT CHECK (first_bedroom_config IN ('Double', 'Twin Singles', 'Not Required')),
  notes                     TEXT,
  calendar_description      TEXT,
  google_event_id           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorised_by              INTEGER REFERENCES users(id),
  authorised_at              TIMESTAMPTZ,
  -- 'google_calendar' marks a booking that was auto-imported from the linked
  -- calendar feed rather than requested through the app; external_guest_name
  -- carries the guest label parsed from that calendar event's summary, since
  -- the row's user_id is the admin who ran the import, not the actual guest.
  source                    TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'google_calendar')),
  external_guest_name       TEXT,
  CHECK (end_date > start_date)
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'google_calendar'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS external_guest_name TEXT;

-- "who_going" was added after the table already existed in some deployments
-- (previously it was only ever folded into calendar_description, not stored
-- on its own) — this backfills it in on existing databases; it's a no-op
-- on a fresh install where the CREATE TABLE above already included it.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS who_going TEXT;

-- 'Not Required' was added as a valid option for the middle/1st bedroom
-- configuration after the table already existed in some deployments — the
-- CREATE TABLE above covers a fresh install, this updates the CHECK
-- constraints on an existing one (Postgres's default auto-generated name
-- for an inline, unnamed column CHECK is "<table>_<column>_check").
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_middle_bedroom_config_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_middle_bedroom_config_check
  CHECK (middle_bedroom_config IN ('Double', 'Twin Singles', 'Not Required'));
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_first_bedroom_config_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_first_bedroom_config_check
  CHECK (first_bedroom_config IN ('Double', 'Twin Singles', 'Not Required'));

CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings (start_date, end_date) WHERE status <> 'cancelled';

-- Single-row settings table (admin-editable): the linked Google Calendar feed.
CREATE TABLE IF NOT EXISTS settings (
  id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_calendar_url TEXT,
  google_calendar_id  TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          INTEGER REFERENCES users(id)
);

INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
