// A small, dependency-free month-grid calendar. Used two ways:
//  - read-only "summary" mode on the homepage (shaded booked/available)
//  - "selectable" mode on the dashboard (guest picks a check-in/check-out range)

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ranges: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD' (checkout day, inclusive —
// it's blocked like every other day of the stay, so this agrees with the
// bookings lists and Google Calendar, which both show the booking as
// running through that date), status}]
function isDateBusy(dateStr, ranges) {
  return ranges.some((r) => dateStr >= r.start && dateStr <= r.end);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// The day box shows its status via colour already (see .cal-grid
// .day.booked.status-* in styles.css), so repeating "Confirmed - " /
// "Provisional - " in the on-box text just crowds out the guest name and
// overflows the box. Strip it for that short text only — the full
// description (hover tooltip, tap-to-view popup) keeps it.
function stripStatusPrefix(line) {
  return String(line).replace(/^(Confirmed|Provisional)\s*[-:]\s*/i, '');
}

function renderMonthGrid(year, month, ranges = [], options = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const first = new Date(year, month, 1);
  // Monday-first weekday index (0=Mon..6=Sun)
  let startOffset = (first.getDay() + 6) % 7;
  const total = daysInMonth(year, month);

  let html = `<div class="cal-month-label">${first.toLocaleString('en-GB', { month: 'long', year: 'numeric' })}</div>`;
  html += '<div class="cal-grid">';
  DOW_LABELS.forEach((d) => { html += `<div class="dow">${d}</div>`; });

  for (let i = 0; i < startOffset; i++) html += '<div class="day blank"></div>';

  for (let day = 1; day <= total; day++) {
    const dateStr = isoDate(year, month, day);
    const occupied = ranges.filter((r) => dateStr >= r.start && dateStr <= r.end);
    const description = occupied[0] && occupied[0].description ? occupied[0].description : null;
    const classes = ['day'];
    if (dateStr < today) classes.push('past');
    else if (occupied.length) {
      classes.push('booked');
      // Confirmed and provisional bookings get different shading — see
      // .cal-grid .day.booked.status-* below. Falls back to the plain
      // "booked" look for anything with no recognised status.
      const status = occupied[0].status;
      if (status === 'confirmed' || status === 'provisional') classes.push(`status-${status}`);
    } else classes.push('available');
    if (dateStr === today) classes.push('today');
    if (options.selectedStart && dateStr === options.selectedStart) classes.push('selected-start');

    if (options.selectable && dateStr >= today && !occupied.length) {
      classes.push('selectable');
      let isSelectionPart = false;
      if (options.selectedStart && options.selectedEnd &&
          dateStr >= options.selectedStart && dateStr < options.selectedEnd) {
        classes.push('in-range');
        isSelectionPart = true;
      }
      if (options.selectedStart && dateStr === options.selectedStart) { classes.push('selected-start'); isSelectionPart = true; }
      if (options.selectedEnd && dateStr === options.selectedEnd) { classes.push('selected-end'); isSelectionPart = true; }
      // Lets a caller (the edit-booking calendar) colour the selected range
      // differently depending on whether it's still the booking's original
      // dates or a newly-picked replacement — see drawEditCalendar().
      if (isSelectionPart && options.selectionVariant) classes.push(`variant-${options.selectionVariant}`);
      // Edit-booking calendar: keep the booking's original dates marked as
      // "current" (red) after a new range is picked, as the legend says.
      if (!isSelectionPart && options.currentStart && options.currentEnd &&
          dateStr >= options.currentStart && dateStr <= options.currentEnd) {
        classes.push('current-dates');
      }
      html += `<div class="${classes.join(' ')}" data-date="${dateStr}" role="button" tabindex="0"><span class="date-number">${day}</span></div>`;
    } else if (occupied.length) {
      // Keep the real line breaks (rather than flattening them with a
      // separator) for both the native hover tooltip on a PC — which
      // renders literal "\n"s on its own — and the tap-to-view popup on
      // touch devices.
      const fullText = description || 'Booked';
      const noteText = description ? stripStatusPrefix(description.split('\n')[0]) : 'Booked';
      html += `<div class="${classes.join(' ')}" title="${escapeHtml(fullText)}" data-full-desc="${escapeHtml(fullText)}"><span class="date-number">${day}</span><span class="date-note">${escapeHtml(noteText)}</span></div>`;
    } else {
      html += `<div class="${classes.join(' ')}"><span class="date-number">${day}</span></div>`;
    }
  }

  html += '</div>';
  return html;
}

// Renders `count` consecutive months starting at (year, startMonth) into `container`.
function renderCalendarMonths(container, year, startMonth, count, ranges = [], options = {}) {
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const m = startMonth + i;
    const y = year + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;
    const div = document.createElement('div');
    div.innerHTML = renderMonthGrid(y, mm, ranges, options);
    container.appendChild(div);
  }
  if (options.selectable) {
    container.querySelectorAll('.day.selectable').forEach((el) => {
      el.addEventListener('click', () => options.onSelect(el.dataset.date));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); options.onSelect(el.dataset.date); }
      });
    });
  }
  // A tap on a booked day shows the same extended description a PC gets on
  // hover, with an X to dismiss — mainly for touch devices, which have no
  // hover state at all. Bound once per container (re-rendering the grid
  // replaces the day elements but the container itself persists).
  if (!container.dataset.popupBound) {
    container.dataset.popupBound = '1';
    container.addEventListener('click', (e) => {
      const dayEl = e.target.closest('.day.booked');
      if (dayEl) showBookingPopup(dayEl.dataset.fullDesc);
    });
  }
}

let bookingPopupEl = null;
function ensureBookingPopup() {
  if (bookingPopupEl) return bookingPopupEl;
  const overlay = document.createElement('div');
  overlay.className = 'cal-popup-overlay';
  overlay.innerHTML =
    '<div class="cal-popup" role="dialog" aria-modal="true">' +
      '<button type="button" class="cal-popup-close" aria-label="Close">&times;</button>' +
      '<div class="cal-popup-body"></div>' +
    '</div>';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) hideBookingPopup(); });
  overlay.querySelector('.cal-popup-close').addEventListener('click', hideBookingPopup);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideBookingPopup(); });
  document.body.appendChild(overlay);
  bookingPopupEl = overlay;
  return overlay;
}
function showBookingPopup(text) {
  const overlay = ensureBookingPopup();
  overlay.querySelector('.cal-popup-body').textContent = text || 'Booked';
  overlay.classList.add('show');
}
function hideBookingPopup() {
  if (bookingPopupEl) bookingPopupEl.classList.remove('show');
}
