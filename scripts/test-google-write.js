require('dotenv').config();
const { upsertGoogleCalendarEvent } = require('../src/calendarSync');

(async () => {
  const id = await upsertGoogleCalendarEvent({
    eventId: null,
    startDate: '2026-12-20',
    endDate: '2026-12-23',
    guestName: 'Test Direct Sync',
    status: 'provisional',
    arrivalTime: '15:00',
    departureTime: '11:00',
    notes: 'Direct sync test',
  });
  console.log('RESULT:', id || 'null');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
