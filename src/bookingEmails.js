// Booking emails (plain text, sent with the same mailer as the account emails):
//   • a stay is requested → the booker gets the details + an edit link, and
//     every admin gets the details + a link to authorise it
//   • a stay is authorised → the booker gets a confirmation with the details
//     and links to edit it and to the two guest guides
// Sending happens after the booking is saved, and a failed email never undoes
// or blocks the booking — it's just logged.
const { query } = require('./db');
const { sendMail } = require('./mailer');
const { publicBase } = require('./auth');
const { fmtDateHuman, fmtDateTimeLine, getCostsLine } = require('./calendarSync');

async function loadBooking(id) {
  const r = await query(
    `SELECT b.*, u.name AS booker_name, u.email AS booker_email, u.phone AS booker_phone
     FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

function dateOnly(v) {
  return typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10);
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

async function detailsText(b) {
  const start = dateOnly(b.start_date);
  const end = dateOnly(b.end_date);
  const costs = await getCostsLine({
    startDate: start,
    endDate: end,
    middleBedroomConfig: b.middle_bedroom_config,
    firstBedroomConfig: b.first_bedroom_config,
  });
  const lines = [
    `Check-in:  ${fmtDateTimeLine(start, b.arrival_time)}`,
    `Check-out: ${fmtDateTimeLine(end, b.departure_time)}`,
  ];
  if (b.who_going) lines.push(`Who's going: ${b.who_going}`);
  if (costs) lines.push(costs);
  if (b.master_bedroom_config) lines.push(`Master bedroom: ${b.master_bedroom_config}`);
  if (b.middle_bedroom_config) lines.push(`Middle bedroom: ${b.middle_bedroom_config}`);
  if (b.first_bedroom_config) lines.push(`1st bedroom: ${b.first_bedroom_config}`);
  if (b.sofa_bed_required) lines.push(`Sofa bed required: ${b.sofa_bed_required}`);
  if (b.baby_cot_required) lines.push(`Baby cot required: ${b.baby_cot_required}`);
  if (b.notes) lines.push(`Other requirements: ${b.notes}`);
  return lines.join('\n');
}

function dateRange(b) {
  return `${fmtDateHuman(dateOnly(b.start_date))} – ${fmtDateHuman(dateOnly(b.end_date))}`;
}

const editLink = (base, b) => `${base}/dashboard.html?tab=my-bookings&booking=${b.id}`;
const authoriseLink = (base, b) => `${base}/dashboard.html?tab=all-bookings&booking=${b.id}`;

async function sendBookingRequestedEmails(req, bookingId) {
  const b = await loadBooking(bookingId);
  if (!b) return;
  const base = publicBase(req);
  const details = await detailsText(b);

  await sendMail({
    to: b.booker_email,
    subject: `Your Casa Moir booking request: ${dateRange(b)}`,
    text:
      `Hi ${firstName(b.booker_name)},\n\n` +
      `Thanks for your booking request for the Moir holiday home. Here are the details:\n\n` +
      `${details}\n\n` +
      `Ali or Dawn will confirm your booking as soon as possible — you'll get another email when they do.\n\n` +
      `Need to change something? Edit your booking here:\n${editLink(base, b)}\n\n` +
      `Ali & Dawn`,
  });

  const admins = await query(
    "SELECT email FROM users WHERE role = 'admin' AND NOT blocked AND id <> $1",
    [b.user_id]
  );
  for (const admin of admins.rows) {
    try {
      await sendMail({
        to: admin.email,
        subject: `New booking request: ${b.who_going || b.booker_name}, ${dateRange(b)}`,
        text:
          `${b.booker_name} has requested a stay at the flat.\n\n` +
          `${details}\n\n` +
          `Booked by: ${b.booker_name}\nEmail: ${b.booker_email}\nPhone: ${b.booker_phone || '—'}\n\n` +
          `To confirm it, open the booking here and tap Confirm:\n${authoriseLink(base, b)}`,
      });
    } catch (err) {
      console.error(`Could not send the new-booking email to ${admin.email}:`, err.message);
    }
  }
}

async function sendBookingConfirmedEmail(req, bookingId) {
  const b = await loadBooking(bookingId);
  if (!b) return;
  const base = publicBase(req);
  await sendMail({
    to: b.booker_email,
    subject: `Your stay is confirmed: ${dateRange(b)}`,
    text:
      `Hi ${firstName(b.booker_name)},\n\n` +
      `Good news — your stay at the Moir holiday home is confirmed. Here are the details:\n\n` +
      `${await detailsText(b)}\n\n` +
      `Edit your booking:\n${editLink(base, b)}\n\n` +
      `Directions & opening up (address, directions from the airport, Wi-Fi):\n${base}/opening-up\n\n` +
      `Closing down & heading home (what to do before you leave):\n${base}/closing-down\n\n` +
      `You'll need to be logged in to see those pages. Have a lovely stay!\n\n` +
      `Ali & Dawn`,
  });
}

// Fire and forget: runs after the response has gone, never throws.
function inBackground(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`${label} failed:`, err.message || err));
}

module.exports = { sendBookingRequestedEmails, sendBookingConfirmedEmail, inBackground };
