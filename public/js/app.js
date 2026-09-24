// Shared front-end logic: session state, login/register modals, nav updates.
// Talks to the Express API defined in /server.js + /src/routes.

const Api = {
  async me() {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (!r.ok) return null;
    const { user } = await r.json();
    return user;
  },
  async register(payload) {
    return Api._send('/api/auth/register', payload);
  },
  async login(payload) {
    return Api._send('/api/auth/login', payload);
  },
  async logout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
  async availability(fromISO, toISO) {
    const r = await fetch(`/api/availability?from=${fromISO}&to=${toISO}`, { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load availability.');
    return data;
  },
  async myBookings() {
    const r = await fetch('/api/bookings', { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load bookings.');
    return data;
  },
  async allBookings() {
    const r = await fetch('/api/bookings?all=1', { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load bookings.');
    return data;
  },
  async createBooking(payload) {
    return Api._send('/api/bookings', payload);
  },
  async authoriseBooking(id) {
    return Api._send(`/api/bookings/${id}/authorise`, {}, 'POST');
  },
  async cancelBooking(id) {
    return Api._send(`/api/bookings/${id}/cancel`, {}, 'POST');
  },
  async adminSettings() {
    const r = await fetch('/api/admin/settings', { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load settings.');
    return data;
  },
  async saveAdminSettings(payload) {
    return Api._send('/api/admin/settings', payload, 'PUT');
  },
  async _send(url, payload, method = 'POST') {
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  },
};

let currentUser = null;
// Where to send someone after they successfully log in / register.
let postAuthRedirect = null;

async function initSession() {
  currentUser = await Api.me();
  renderNav();
  return currentUser;
}

function renderNav() {
  const slot = document.getElementById('nav-account');
  if (!slot) return;

  if (currentUser) {
    slot.innerHTML = `
      <span style="font-size:0.9rem;color:var(--ink-soft)">Hi, ${escapeHtml(currentUser.name.split(' ')[0])}</span>
      <a class="btn btn-ghost btn-small" href="/dashboard.html">${currentUser.role === 'admin' ? 'Admin' : 'My bookings'}</a>
      <button class="btn btn-secondary btn-small" id="logout-btn">Log out</button>
    `;
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await Api.logout();
      currentUser = null;
      window.location.href = '/';
    });
  } else {
    slot.innerHTML = `
      <button class="btn btn-ghost btn-small" id="nav-login-btn">Log in</button>
      <button class="btn btn-primary btn-small" id="nav-book-btn">Book Now</button>
    `;
    document.getElementById('nav-login-btn').addEventListener('click', () => openAuthModal('login'));
    document.getElementById('nav-book-btn').addEventListener('click', () => onBookNowClick());
  }
}

function onBookNowClick(intent) {
  if (currentUser) {
    window.location.href = '/dashboard.html' + (intent ? `?dates=${intent.start},${intent.end}` : '');
  } else {
    postAuthRedirect = intent ? `/dashboard.html?dates=${intent.start},${intent.end}` : '/dashboard.html';
    openAuthModal('register');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* -------------------- Auth modal -------------------- */

function buildAuthModal() {
  if (document.getElementById('auth-modal')) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'auth-modal';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <button class="close-x" aria-label="Close">&times;</button>
      <h3 id="auth-modal-title">Log in</h3>
      <p class="sub" id="auth-modal-sub">Log in to book your stay at Mirador de Calahonda.</p>
      <div class="form-error" id="auth-error"></div>

      <form id="login-form">
        <div class="field">
          <label for="login-email">Email</label>
          <input id="login-email" type="email" required autocomplete="email" />
        </div>
        <div class="field">
          <label for="login-password">Password</label>
          <input id="login-password" type="password" required autocomplete="current-password" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Log in</button>
        <p class="modal-switch">New here? <a href="#" id="switch-to-register">Create an account</a></p>
      </form>

      <form id="register-form" style="display:none">
        <div class="field">
          <label for="reg-name">Full name</label>
          <input id="reg-name" type="text" required autocomplete="name" />
        </div>
        <div class="field">
          <label for="reg-email">Email</label>
          <input id="reg-email" type="email" required autocomplete="email" />
        </div>
        <div class="field">
          <label for="reg-phone">Phone number</label>
          <input id="reg-phone" type="tel" required autocomplete="tel" />
        </div>
        <div class="field">
          <label for="reg-password">Password</label>
          <input id="reg-password" type="password" required minlength="8" autocomplete="new-password" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Create account</button>
        <p class="modal-switch">Already have an account? <a href="#" id="switch-to-login">Log in</a></p>
      </form>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelector('.close-x').addEventListener('click', closeAuthModal);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeAuthModal(); });

  wrap.querySelector('#switch-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthMode('register');
  });
  wrap.querySelector('#switch-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthMode('login');
  });

  wrap.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    try {
      const { user } = await Api.login({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      });
      currentUser = user;
      afterAuthSuccess();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  wrap.querySelector('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    try {
      const { user } = await Api.register({
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        phone: document.getElementById('reg-phone').value,
        password: document.getElementById('reg-password').value,
      });
      currentUser = user;
      afterAuthSuccess();
    } catch (err) {
      showAuthError(err.message);
    }
  });
}

function showAuthMode(mode) {
  const modal = document.getElementById('auth-modal');
  const isLogin = mode === 'login';
  modal.querySelector('#login-form').style.display = isLogin ? 'block' : 'none';
  modal.querySelector('#register-form').style.display = isLogin ? 'none' : 'block';
  modal.querySelector('#auth-modal-title').textContent = isLogin ? 'Log in' : 'Create your account';
  modal.querySelector('#auth-modal-sub').textContent = isLogin
    ? 'Log in to book your stay at Mirador de Calahonda.'
    : "We just need a few details so we know who's staying — then you can pick your dates.";
  hideAuthError();
}

function openAuthModal(mode) {
  buildAuthModal();
  showAuthMode(mode || 'login');
  document.getElementById('auth-modal').classList.add('open');
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.remove('open');
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.add('show');
}
function hideAuthError() {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

function afterAuthSuccess() {
  closeAuthModal();
  renderNav();
  window.location.href = postAuthRedirect || '/dashboard.html';
}

/* -------------------- Lightbox (used on index.html gallery) -------------------- */

function initLightbox(images) {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  const img = lb.querySelector('img');
  const caption = lb.querySelector('figcaption');
  let index = 0;

  function show(i) {
    index = (i + images.length) % images.length;
    img.src = images[index].src;
    img.alt = images[index].alt;
    caption.textContent = images[index].alt;
  }

  document.querySelectorAll('[data-lightbox-index]').forEach((btn) => {
    btn.addEventListener('click', () => {
      show(Number(btn.dataset.lightboxIndex));
      lb.classList.add('open');
    });
  });

  lb.querySelector('.lightbox-close').addEventListener('click', () => lb.classList.remove('open'));
  lb.querySelector('.prev').addEventListener('click', () => show(index - 1));
  lb.querySelector('.next').addEventListener('click', () => show(index + 1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', (e) => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') lb.classList.remove('open');
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSession();
});
