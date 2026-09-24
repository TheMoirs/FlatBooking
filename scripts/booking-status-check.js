require('dotenv').config();
const jwt = require('jsonwebtoken');

(async () => {
  const token = jwt.sign(
    { id: 2, email: 'ali@themoirs.co.uk', role: 'admin', name: 'Ali Moir' },
    process.env.JWT_SECRET,
    { expiresIn: 60 * 60 * 24 * 7 }
  );

  const res = await fetch('http://localhost:3000/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `mirador_session=${token}`,
    },
    body: JSON.stringify({
      start_date: '2026-12-17',
      end_date: '2026-12-20',
      who_going: 'Status Test',
      arrival_time: '15:00',
      departure_time: '11:00',
      master_bedroom_config: 'Double',
      middle_bedroom_config: 'Double',
      first_bedroom_config: '',
      notes: 'Status test',
    }),
  });

  const text = await res.text();
  console.log('status', res.status);
  console.log(text);
})();
