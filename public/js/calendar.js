// A small, dependency-free month-grid calendar. Used two ways:
//  - read-only "summary" mode on the homepage (shaded booked/available)
//  - "selectable" mode on the dashboard (guest picks a check-in/check-out range)

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ranges: [{start:'YYYY-MM-DD', end:'YYYY-MM-DD' (exclusive), status}]
function isDateBusy(dateStr, ranges) {
  return ranges.some((r) => dateStr >= r.start && dateStr < r.end);
}

function renderMonthGrid(year, month, ranges, options = {}) {
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
    const classes = ['day'];
    if (dateStr < today) classes.push('past');
    else if (isDateBusy(dateStr, ranges)) classes.push('booked');
    else classes.push('available');
    if (dateStr === today) classes.push('today');

    if (options.selectable && dateStr >= today && !isDateBusy(dateStr, ranges)) {
      classes.push('selectable');
      if (options.selectedStart && options.selectedEnd &&
          dateStr >= options.selectedStart && dateStr < options.selectedEnd) {
        classes.push('in-range');
      }
      html += `<div class="${classes.join(' ')}" data-date="${dateStr}" role="button" tabindex="0">${day}</div>`;
    } else {
      html += `<div class="${classes.join(' ')}">${day}</div>`;
    }
  }

  html += '</div>';
  return html;
}

// Renders `count` consecutive months starting at (year, startMonth) into `container`.
function renderCalendarMonths(container, year, startMonth, count, ranges, options = {}) {
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
}
