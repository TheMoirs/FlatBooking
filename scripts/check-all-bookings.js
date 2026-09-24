require('dotenv').config();
const jwt = require('jsonwebtoken');

(async () => {
  const token = jwt.sign({ id: 2, email: 'ali@themoirs.co.uk', role: 'admin', name: 'Ali Moir' }, process.env.JWT_SECRET, { expiresIn: 60 * 60 * 24 * 7 });
  const response = await fetch('http://localhost:3000/api/bookings?all=1', {
    headers: {
      Cookie: `mirador_session=${token}`,
    },
  });
  const text = await response.text();
  console.log('status=', response.status);
  console.log(text);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
