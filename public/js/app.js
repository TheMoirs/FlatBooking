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
  async googleClientId() {
    const r = await fetch('/api/auth/google-client-id');
    const data = await r.json().catch(() => ({}));
    return data.client_id || null;
  },
  async googleSignIn(credential) {
    return Api._send('/api/auth/google', { credential });
  },
  async googleCompleteSignUp(pendingToken, phone) {
    return Api._send('/api/auth/google/complete', { pending_token: pendingToken, phone });
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
  // Public — no login required, since it also feeds the Costs page on the
  // homepage. Just the charges, not the rest of what admin settings holds.
  async charges() {
    const r = await fetch('/api/charges');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load charges.');
    return data;
  },
  async myBookings() {
    // Always show everything — there's no "show old bookings" toggle any more.
    const r = await fetch(`/api/bookings?includeOld=1`, { credentials: 'include' });
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
  async editBooking(id, payload) {
    return Api._send(`/api/bookings/${id}`, payload, 'PUT');
  },
  async authoriseBooking(id) {
    return Api._send(`/api/bookings/${id}/authorise`, {}, 'POST');
  },
  async unauthoriseBooking(id) {
    return Api._send(`/api/bookings/${id}/unauthorise`, {}, 'POST');
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
      <a class="btn btn-ghost btn-small" id="nav-bookings-link" href="${currentUser.role === 'admin' ? '/dashboard.html' : '/dashboard.html?tab=new-booking'}">${currentUser.role === 'admin' ? 'Admin' : 'Bookings'}</a>
      <button class="btn btn-secondary btn-small" id="logout-btn">Log out</button>
    `;
    // "Bookings" goes to the person's existing bookings if they have any,
    // otherwise straight to a new booking.
    if (currentUser.role !== 'admin') {
      const link = document.getElementById('nav-bookings-link');
      const hasBookings = Api.myBookings()
        .then((d) => Array.isArray(d.bookings) && d.bookings.length > 0)
        .catch(() => false);
      hasBookings.then((has) => { link.href = `/dashboard.html?tab=${has ? 'my-bookings' : 'new-booking'}`; });
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const has = await hasBookings;
        window.location.href = `/dashboard.html?tab=${has ? 'my-bookings' : 'new-booking'}`;
      });
    }
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
    // Defaults to the login form — most people clicking "Book Now" already
    // have an account. The form itself has a "Create an account" link for
    // anyone who doesn't.
    openAuthModal('login');
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

      <div id="google-signin-section">
        <div id="google-signin-btn" class="google-signin-btn"></div>
        <p class="auth-divider"><span>or</span></p>
      </div>

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

      <form id="google-phone-form" style="display:none">
        <p class="sub" style="margin-top:0">Google doesn't share a phone number with us, so we just need yours to finish setting up your account.</p>
        <div class="field">
          <label for="google-phone">Phone number</label>
          <input id="google-phone" type="tel" required autocomplete="tel" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Finish creating account</button>
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

  wrap.querySelector('#google-phone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    if (!pendingGoogleSignup) {
      showAuthError('That sign-up has expired — please start again with Google.');
      return;
    }
    try {
      const { user } = await Api.googleCompleteSignUp(
        pendingGoogleSignup.token,
        document.getElementById('google-phone').value
      );
      pendingGoogleSignup = null;
      currentUser = user;
      afterAuthSuccess();
    } catch (err) {
      showAuthError(err.message);
    }
  });

  initGoogleSignIn();
}

// Holds the short-lived server token + name/email from a Google sign-in
// that turned out to be a new account, between showing the "what's your
// phone number" step and that form's own submit handler completing it.
let pendingGoogleSignup = null;
let googleSignInScriptPromise = null;
// Tri-state: null while initGoogleSignIn() hasn't resolved yet, then true/
// false once it's known whether the button is actually available — so
// showAuthMode() knows not to un-hide a section that was deliberately
// hidden because there's no client id configured or the script failed to load.
let googleSignInAvailable = null;

// Loads https://accounts.google.com/gsi/client once (lazily, only once
// someone actually opens the auth modal), then renders the "Continue with
// Google" button. If GOOGLE_CLIENT_ID isn't set on the server, Google
// sign-in just doesn't appear — the email/password forms work exactly as
// before.
async function initGoogleSignIn() {
  const section = document.getElementById('google-signin-section');
  try {
    const clientId = await Api.googleClientId();
    if (!clientId) {
      googleSignInAvailable = false;
      section.style.display = 'none';
      return;
    }
    if (!googleSignInScriptPromise) {
      googleSignInScriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    await googleSignInScriptPromise;
    google.accounts.id.initialize({ client_id: clientId, callback: handleGoogleCredential });
    google.accounts.id.renderButton(document.getElementById('google-signin-btn'), {
      theme: 'outline',
      size: 'large',
      width: 320,
      text: 'continue_with',
    });
    googleSignInAvailable = true;
  } catch (err) {
    // No network access to Google, an ad blocker, etc. — fail quietly and
    // just hide the Google option rather than showing a broken button.
    googleSignInAvailable = false;
    section.style.display = 'none';
  }
}

async function handleGoogleCredential(response) {
  hideAuthError();
  try {
    const result = await Api.googleSignIn(response.credential);
    if (result.needs_phone) {
      pendingGoogleSignup = { token: result.pending_token, name: result.name, email: result.email };
      showAuthMode('google-phone');
    } else {
      currentUser = result.user;
      afterAuthSuccess();
    }
  } catch (err) {
    showAuthError(err.message);
  }
}

function showAuthMode(mode) {
  const modal = document.getElementById('auth-modal');
  const isLogin = mode === 'login';
  const isGooglePhone = mode === 'google-phone';

  modal.querySelector('#login-form').style.display = !isGooglePhone && isLogin ? 'block' : 'none';
  modal.querySelector('#register-form').style.display = !isGooglePhone && !isLogin ? 'block' : 'none';
  modal.querySelector('#google-phone-form').style.display = isGooglePhone ? 'block' : 'none';
  // The Google button + divider only make sense while picking how to sign
  // in — not mid-way through finishing a Google sign-up, and not at all if
  // it turned out not to be available (googleSignInAvailable === false).
  if (googleSignInAvailable !== false) {
    modal.querySelector('#google-signin-section').style.display = isGooglePhone ? 'none' : '';
  }

  if (isGooglePhone) {
    modal.querySelector('#auth-modal-title').textContent = 'One more thing';
    modal.querySelector('#auth-modal-sub').textContent = `Welcome, ${pendingGoogleSignup ? pendingGoogleSignup.name.split(' ')[0] : 'there'}.`;
  } else {
    modal.querySelector('#auth-modal-title').textContent = isLogin ? 'Log in' : 'Create your account';
    modal.querySelector('#auth-modal-sub').textContent = isLogin
      ? 'Log in to book your stay at Mirador de Calahonda.'
      : "We just need a few details so we know who's staying — then you can pick your dates.";
  }
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
  // Straight to the home page after logging in, unless they got here via
  // "Book Now" / a date pick (postAuthRedirect).
  window.location.href = postAuthRedirect || '/';
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

// Below the breakpoint where .main-nav is hidden (see styles.css), this
// toggle button shows/hides it as a dropdown instead — present only on the
// pages that have a .main-nav to begin with (availability.html and
// agent-bookings.html don't), so both lookups are defensive.
function initMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.querySelector('.main-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });
  // Picking a link closes the menu — otherwise it stays open over the page
  // after an in-page anchor jump (e.g. #costs), covering the content.
  nav.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSession();
  initMobileNav();
});
