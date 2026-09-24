const jwt = require('jsonwebtoken');
const secret = '22d9410e89f4cb1d9893cd0e5754e077110db23adbb9db014054567bc3e37a66d73a13095970e10f32cd18b6bd983e06';
const cookie = 'mirador_session=' + jwt.sign({ id: 2, email: 'ali@themoirs.co.uk', role: 'admin', name: 'Ali Moir' }, secret, { expiresIn: 60 * 60 * 24 * 7 });

fetch('http://localhost:3000/api/bookings?all=1', { headers: { Cookie: cookie } })
  .then(async (r) => {
    const text = await r.text();
    console.log('status=' + r.status);
    console.log(text.slice(0, 500));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
