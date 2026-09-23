# Mirador de Calahonda — booking website

A website for the Moirs' Spanish holiday flat: public photos, details and an
availability calendar, plus accounts and a provisional-booking flow for
family and friends.

## How it works

- **Public** (no login): home page with photos, description, amenities,
  costs, and a read-only calendar shaded booked/available. A "Things to do"
  page lists nearby restaurants, bars and activities with website and map
  links.
- **Book Now**: prompts anyone not logged in to create an account or log in
  (name, email, phone, password).
- **Logged-in guests**: can pick a check-in/check-out range on an interactive
  calendar and submit it — this creates a **provisional** booking.
- **Admins**: any account registered with an email listed in `ADMIN_EMAILS`
  (by default `ali@themoirs.co.uk` and `dawn@themoirs.co.uk`) automatically
  gets admin rights. Admins get two extra tabs: **All bookings** (authorise
  or cancel any booking) and **Calendar settings** (paste a linked Google
  Calendar feed so external bookings also block those dates on the public
  calendar).

### Stack

- Frontend: plain HTML/CSS/JS (`/public`) — no build step.
- Backend: Node.js + Express (`server.js`, `/src`).
- Database: PostgreSQL — designed for [Neon](https://neon.tech)'s free tier,
  the same setup already used for the boules tournament manager.
- Sessions: a signed JWT in an httpOnly cookie (no separate session store
  needed).

## Running it locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL and JWT_SECRET
npm run migrate           # creates the users/bookings/settings tables
npm run dev
```

Visit `http://localhost:3000`.

Generate a `JWT_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Deploying (Render + Neon — free tier)

This mirrors the zero-cost stack already used for the boules tournament
manager:

1. **Database — Neon**
   - Create a new Neon project (or a new database inside an existing
     project) for this site.
   - Copy the **pooled connection string** from the Neon dashboard.
   - Run `npm run migrate` once, locally, with that connection string in
     `.env`, to create the tables — or paste `schema.sql` into Neon's SQL
     editor.

2. **App — Render**
   - Push this folder to a GitHub repo.
   - In Render, create a new **Web Service** from that repo.
     - Build command: `npm install`
     - Start command: `npm start`
   - Add environment variables in Render's dashboard:
     - `DATABASE_URL` — the Neon connection string
     - `JWT_SECRET` — the random string generated above
     - `ADMIN_EMAILS` — `ali@themoirs.co.uk,dawn@themoirs.co.uk` (add more,
       comma-separated, as needed)
     - `NODE_ENV` — `production`
   - Deploy. Render assigns a free `*.onrender.com` URL — share that with
     family and friends.

3. **Linking the Google Calendar (optional, admin-only)**
   - In Google Calendar: **Settings → [your calendar] → Integrate calendar**
     → copy the **"Secret address in iCal format"** link (not the public
     web link — Google only exposes events programmatically via that iCal
     feed).
   - Log in as an admin on the site, go to **Calendar settings**, and paste
     it in. The public availability calendar will then also block whatever
     is busy on that calendar.

## API summary

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/availability` | Public | Booked/available date ranges (internal + linked calendar) |
| POST | `/api/auth/register` | Public | Create an account |
| POST | `/api/auth/login` | Public | Log in |
| POST | `/api/auth/logout` | Public | Log out |
| GET | `/api/auth/me` | Public | Current session, if any |
| GET | `/api/bookings` | Logged in | Your own bookings |
| GET | `/api/bookings?all=1` | Admin | Every booking |
| POST | `/api/bookings` | Logged in | Request a stay (creates a `provisional` booking) |
| POST | `/api/bookings/:id/authorise` | Admin | Confirm a provisional booking |
| POST | `/api/bookings/:id/cancel` | Owner or admin | Cancel a booking |
| GET/PUT | `/api/admin/settings` | Admin | Read/save the linked calendar URL |

## Notes and assumptions

- **Admin emails are hardcoded via an environment variable**, not stored in
  the database, so they can't accidentally be changed from within the site.
  Add or remove addresses by editing `ADMIN_EMAILS` in Render and
  redeploying.
- **Overlap checking** happens server-side when a booking is submitted, so
  two people can't be given the same dates even if the calendar hasn't
  refreshed for both of them yet.
- **Provisional bookings block the calendar** for other guests as soon as
  they're requested (not just once authorised) — so nobody unknowingly
  double-books while an admin decides. If you'd rather provisional bookings
  didn't hold the date until authorised, that's a one-line change in
  `src/routes/bookings.js` (`GET /availability`).
- The photos in `/public/images` and the Things To Do links in
  `/public/js/things-to-do-data.js` came from the two documents you shared —
  swap in new photos or edit that file directly to update either.
