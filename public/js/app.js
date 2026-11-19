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
  async forgotPassword(email) {
    return Api._send('/api/auth/forgot', { email });
  },
  async resetPassword(token, password) {
    return Api._send('/api/auth/reset', { token, password });
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
  async adminUsers() {
    const r = await fetch('/api/admin/users', { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load users.');
    return data;
  },
  async adminUpdateUser(id, payload) {
    return Api._send(`/api/admin/users/${id}`, payload, 'PUT');
  },
  async adminSetUserBlocked(id, blocked) {
    return Api._send(`/api/admin/users/${id}/${blocked ? 'block' : 'unblock'}`, {}, 'POST');
  },
  async savePreauthorised(emails) {
    return Api._send('/api/admin/preauthorised', { emails }, 'PUT');
  },
  async adminNewAgentLink() {
    return Api._send('/api/admin/agent-link', {}, 'POST');
  },
  async adminResetLink(id) {
    return Api._send(`/api/admin/users/${id}/reset-link`, {}, 'POST');
  },
  async adminDeleteUser(id, withBookings) {
    const r = await fetch(`/api/admin/users/${id}${withBookings ? '?with_bookings=1' : ''}`, { method: 'DELETE', credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(data.error || 'Something went wrong.');
      err.needsBookingConfirmation = !!data.needs_booking_confirmation;
      throw err;
    }
    return data;
  },
  async guide(slug) {
    const r = await fetch(`/api/guides/${encodeURIComponent(slug)}`, { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load this guide.');
    return data;
  },
  async adminGuides() {
    const r = await fetch('/api/admin/guides', { credentials: 'include' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Unable to load the guides.');
    return data;
  },
  async saveAdminGuide(slug, body) {
    return Api._send(`/api/admin/guides/${encodeURIComponent(slug)}`, { body }, 'PUT');
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
let accountMenuListenersAdded = false;
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
      <span style="font-size:0.9rem;color:var(--ink-soft)">Hi ${escapeHtml(currentUser.name.split(' ')[0])}</span>
      <div class="page-menu account-menu">
        <button type="button" class="page-menu-btn" id="account-menu-btn" aria-label="Account menu" aria-haspopup="true" aria-expanded="false">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor"/><rect x="3" y="9" width="14" height="2" rx="1" fill="currentColor"/><rect x="3" y="14" width="14" height="2" rx="1" fill="currentColor"/></svg>
        </button>
        <div class="page-menu-list" id="account-menu-list" role="menu" hidden>
          <button type="button" role="menuitem" data-href="/opening-up">Directions &amp; opening up</button>
          <button type="button" role="menuitem" data-href="/closing-down">Closing down &amp; heading home</button>
          <hr class="page-menu-sep" />
          ${currentUser.role === 'admin' ? `
          <button type="button" role="menuitem" data-dash-tab="users">Users</button>
          <button type="button" role="menuitem" data-dash-tab="settings">Settings</button>
          <hr class="page-menu-sep" />` : ''}
          <button type="button" role="menuitem" id="add-shortcut-btn">Add to home screen</button>
          <button type="button" role="menuitem" id="setup-passkey-btn" hidden>Set up fingerprint / Face ID</button>
          <button type="button" role="menuitem" id="logout-btn">Log out</button>
        </div>
      </div>
    `;
    // The dashboard picks the right tab itself: All bookings for admins;
    // My bookings for anyone with an upcoming stay, otherwise New booking.
    const menuBtn = document.getElementById('account-menu-btn');
    const menuList = document.getElementById('account-menu-list');
    const setMenu = (open) => {
      menuList.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(menuList.hidden); });
    if (!accountMenuListenersAdded) {
      accountMenuListenersAdded = true;
      document.addEventListener('click', (e) => {
        const list = document.getElementById('account-menu-list');
        if (list && !e.target.closest('.account-menu')) { list.hidden = true; document.getElementById('account-menu-btn').setAttribute('aria-expanded', 'false'); }
      });
      document.addEventListener('keydown', (e) => {
        const list = document.getElementById('account-menu-list');
        if (e.key === 'Escape' && list) { list.hidden = true; document.getElementById('account-menu-btn').setAttribute('aria-expanded', 'false'); }
      });
    }
    // Users and Settings live in this menu rather than the dashboard's tab
    // bar. On the dashboard they switch panel in place; elsewhere they open
    // the dashboard on that panel.
    menuList.querySelectorAll('[data-href]').forEach((btn) => {
      btn.addEventListener('click', () => { window.location.href = btn.dataset.href; });
    });
    menuList.querySelectorAll('[data-dash-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setMenu(false);
        const tab = btn.dataset.dashTab;
        if (typeof window.dashShowTab === 'function') window.dashShowTab(tab);
        else window.location.href = '/dashboard.html?tab=' + tab;
      });
    });
    document.getElementById('add-shortcut-btn').addEventListener('click', () => { setMenu(false); addShortcut(); });
    const passkeyBtn = document.getElementById('setup-passkey-btn');
    passkeysSupported().then((ok) => { passkeyBtn.hidden = !ok; });
    passkeyBtn.addEventListener('click', async () => {
      setMenu(false);
      try {
        const result = await setUpPasskey();
        if (result === 'done') showInfoModal('All set', 'Next time, tap <strong>Log in with fingerprint / Face ID</strong> on the login screen.');
        else if (result === 'already') showInfoModal('Already set up', 'Fingerprint / Face ID login is already set up on this device.');
      } catch (err) {
        showInfoModal("Couldn't set it up", escapeHtml(err.message));
      }
    });
    document.getElementById('logout-btn').addEventListener('click', async () => {
      setMenu(false);
      await Api.logout();
      currentUser = null;
      window.location.href = '/';
    });
  } else {
    slot.innerHTML = `
      <button class="btn btn-ghost btn-small" id="nav-login-btn">Log in</button>
    `;
    document.getElementById('nav-login-btn').addEventListener('click', () => startLogin());
    // Get the fingerprint login ready, so tapping "Log in" can go straight to it.
    passkeysSupported().then(() => { if (passkeyLoginAvailable()) preparePasskeyLogin(); });
  }
}

// The "Book Now" nav link opens My account → Request a stay. Anyone not
// logged in gets the login popup first, then lands there.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a.nav-book-now');
  if (!link) return;
  if (currentUser) {
    // Already on the dashboard: just switch tab.
    if (typeof window.dashShowTab === 'function') { e.preventDefault(); window.dashShowTab('new-booking'); }
    return;
  }
  e.preventDefault();
  postAuthRedirect = link.getAttribute('href');
  startLogin();
});

function onBookNowClick(intent) {
  if (currentUser) {
    window.location.href = '/dashboard.html' + (intent ? `?dates=${intent.start},${intent.end}` : '');
  } else {
    postAuthRedirect = intent ? `/dashboard.html?dates=${intent.start},${intent.end}` : '/dashboard.html';
    // Defaults to the login form — most people clicking "Book Now" already
    // have an account. The form itself has a "Create an account" link for
    // anyone who doesn't.
    startLogin();
  }
}

// Turns a guide's plain text (as typed in admin Settings) into HTML:
//   blank line        → new paragraph (single line breaks are kept)
//   "1. " / "1) "     → numbered step; following lines continue the step
//   "# Heading"       → heading
//   **bold**, [text](https://…), bare https://… → bold / links
// Everything is escaped first, so nothing typed can become live HTML.
function renderGuide(text) {
  const inline = (t) => escapeHtml(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"'<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)"'>]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const html = [];
  let para = [];
  let list = null; // { start, items: [] }
  const flushPara = () => { if (para.length) html.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  const flushList = () => {
    if (list) html.push(`<ol${list.start !== 1 ? ` start="${list.start}"` : ''}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`);
    list = null;
  };
  String(text || '').replace(/\r/g, '').split('\n').forEach((raw) => {
    const line = raw.trim();
    const step = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (!line) { flushPara(); if (list) list.gap = true; return; }
    if (line.startsWith('# ')) { flushPara(); flushList(); html.push(`<h2>${inline(line.slice(2))}</h2>`); return; }
    if (step) {
      flushPara();
      if (!list) list = { start: Number(step[1]), items: [] };
      list.items.push(step[2]);
      list.gap = false;
      return;
    }
    if (list && !list.gap) { list.items[list.items.length - 1] += ' ' + line; return; }
    flushList();
    para.push(line);
  });
  flushPara();
  flushList();
  return html.join('\n');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* -------------------- Add to home screen -------------------- */

// Browsers that can add the shortcut themselves (Chrome and Edge on Android
// and computers) offer it through this event; others (iPhones, Firefox)
// get step-by-step instructions instead.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });

function shortcutSteps() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return [
    'Tap the <strong>Share</strong> button (the square with an arrow pointing up) in Safari’s toolbar.',
    'Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.',
  ];
  if (/Android/.test(ua)) return [
    'Tap your browser’s menu (usually <strong>⋮</strong> at the top or bottom right).',
    'Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>), then <strong>Add</strong>.',
  ];
  return [
    'In Chrome or Edge, open the browser menu (<strong>⋮</strong> or <strong>…</strong> at the top right).',
    'Choose <strong>Install</strong>, or <strong>Cast, save and share → Install page as app</strong> in Chrome. In other browsers, bookmark this page.',
  ];
}

function buildShortcutModal() {
  if (document.getElementById('home-shortcut-modal')) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'home-shortcut-modal';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="home-shortcut-title">
      <button class="close-x" aria-label="Close">&times;</button>
      <h3 id="home-shortcut-title">Add to home screen</h3>
      <p class="sub">Open Casa Moir straight from your phone or computer, like an app.</p>
      <ol id="home-shortcut-steps" style="line-height:1.7;padding-left:20px;margin:0 0 16px"></ol>
      <button class="btn btn-primary" type="button" id="home-shortcut-ok" style="width:100%;justify-content:center">OK</button>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.classList.remove('open');
  wrap.querySelector('.close-x').addEventListener('click', close);
  wrap.querySelector('#home-shortcut-ok').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}

async function addShortcut() {
  if (installPrompt) {
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* ignore */ }
    installPrompt = null;
    return;
  }
  buildShortcutModal();
  document.getElementById('home-shortcut-steps').innerHTML = shortcutSteps().map((s) => `<li>${s}</li>`).join('');
  document.getElementById('home-shortcut-modal').classList.add('open');
}

/* -------------------- Fingerprint / Face ID (passkeys) -------------------- */

// localStorage can be unavailable (private browsing, some in-app browsers).
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }
const passkeySetKey = (userId) => `casamoir-passkey-${userId}`;
const passkeyDismissedKey = (userId) => `casamoir-passkey-dismissed-${userId}`;
// Set once fingerprint / Face ID has been set up or used on this device, for
// anyone. The login popup only offers it on devices like that — elsewhere
// the phone would just say "No passkeys available".
const PASSKEY_DEVICE_KEY = 'casamoir-passkey-device';
// Which passkey this device holds, so login can ask for it by name.
const PASSKEY_CRED_KEY = 'casamoir-passkey-credential';
function rememberPasskeyOnDevice(userId, credentialId) {
  lsSet(passkeySetKey(userId), '1');
  lsSet(PASSKEY_DEVICE_KEY, '1');
  if (credentialId) lsSet(PASSKEY_CRED_KEY, credentialId);
}
function passkeyLoginAvailable() {
  return passkeySupport === true && Boolean(lsGet(PASSKEY_DEVICE_KEY));
}
const PASSKEY_OFFER_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // "Not now" = 30 days

let passkeySupport = null;
async function passkeysSupported() {
  if (passkeySupport !== null) return passkeySupport;
  try {
    passkeySupport = Boolean(window.isSecureContext && window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) {
    passkeySupport = false;
  }
  return passkeySupport;
}

// The browser helper is only fetched when someone actually uses it.
let webauthnLib = null;
function loadWebAuthnLib() {
  if (!webauthnLib) {
    webauthnLib = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/js/vendor/simplewebauthn-browser.min.js';
      script.onload = () => resolve(window.SimpleWebAuthnBrowser);
      script.onerror = () => {
        webauthnLib = null;
        reject(new Error("Couldn't load fingerprint / Face ID support. Please try again."));
      };
      document.head.appendChild(script);
    });
  }
  return webauthnLib;
}

async function shouldOfferPasskey() {
  if (!currentUser || !(await passkeysSupported())) return false;
  if (lsGet(passkeySetKey(currentUser.id))) return false;
  const dismissedAt = Number(lsGet(passkeyDismissedKey(currentUser.id)) || 0);
  return !(dismissedAt && Date.now() - dismissedAt < PASSKEY_OFFER_SNOOZE_MS);
}

// Returns 'done', 'already' (this device was set up before) or 'cancelled'.
async function setUpPasskey() {
  const lib = await loadWebAuthnLib();
  const options = await Api._send('/api/auth/passkey/register/options', {});
  let attestation;
  try {
    attestation = await lib.startRegistration({ optionsJSON: options });
  } catch (err) {
    if (err && (err.name === 'InvalidStateError' || err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED')) {
      rememberPasskeyOnDevice(currentUser.id);
      return 'already';
    }
    if (err && err.name === 'NotAllowedError') return 'cancelled';
    throw err;
  }
  const saved = await Api._send('/api/auth/passkey/register/verify', attestation);
  rememberPasskeyOnDevice(currentUser.id, saved.credentialId || attestation.id);
  return 'done';
}

// Returns the logged-in user, or null if they cancelled the prompt.
// The login options are fetched ahead of time (see preparePasskeyLogin) so
// that tapping "Log in" can open the fingerprint prompt straight away —
// some browsers (Safari) only allow that right after a tap.
let preparedLogin = null; // { at, promise }
const PREPARED_LOGIN_TTL_MS = 4 * 60 * 1000; // the server allows 5 minutes
function fetchPasskeyLoginOptions() {
  return Api._send('/api/auth/passkey/login/options', { credentialId: lsGet(PASSKEY_CRED_KEY) || undefined });
}
function preparePasskeyLogin() {
  if (preparedLogin && Date.now() - preparedLogin.at < PREPARED_LOGIN_TTL_MS) return;
  const promise = fetchPasskeyLoginOptions();
  promise.catch(() => { preparedLogin = null; });
  preparedLogin = { at: Date.now(), promise };
  loadWebAuthnLib().catch(() => {});
}

async function loginWithPasskey() {
  const lib = await loadWebAuthnLib();
  let options;
  if (preparedLogin && Date.now() - preparedLogin.at < PREPARED_LOGIN_TTL_MS) {
    options = await preparedLogin.promise;
  } else {
    options = await fetchPasskeyLoginOptions();
  }
  preparedLogin = null; // each challenge works once
  let assertion;
  try {
    assertion = await lib.startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (err && err.name === 'NotAllowedError') return null;
    throw err;
  }
  const { user } = await Api._send('/api/auth/passkey/login/verify', assertion);
  rememberPasskeyOnDevice(user.id, assertion.id);
  return user;
}

// A simple message popup (title + text + OK).
function showInfoModal(title, html) {
  let wrap = document.getElementById('info-modal');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.id = 'info-modal';
    wrap.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="info-modal-title">
        <button class="close-x" aria-label="Close">&times;</button>
        <h3 id="info-modal-title"></h3>
        <p id="info-modal-text" style="line-height:1.6"></p>
        <button class="btn btn-primary" type="button" id="info-modal-ok" style="width:100%;justify-content:center">OK</button>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.classList.remove('open');
    wrap.querySelector('.close-x').addEventListener('click', close);
    wrap.querySelector('#info-modal-ok').addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  }
  wrap.querySelector('#info-modal-title').textContent = title;
  wrap.querySelector('#info-modal-text').innerHTML = html;
  wrap.classList.add('open');
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

      <div id="passkey-login-section" style="display:none;margin-bottom:12px">
        <button class="btn btn-secondary" type="button" id="passkey-login-btn" style="width:100%;justify-content:center">Log in with fingerprint / Face ID</button>
      </div>
      <div id="google-signin-section">
        <div id="google-signin-btn" class="google-signin-btn"></div>
      </div>
      <p class="auth-divider" id="auth-divider"><span>or</span></p>

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
        <p class="modal-switch"><a href="#" id="switch-to-forgot">Forgotten your password?</a></p>
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

      <form id="forgot-form" style="display:none">
        <div class="field">
          <label for="forgot-email">Email</label>
          <input id="forgot-email" type="email" required autocomplete="email" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Email me a reset link</button>
        <p class="modal-switch"><a href="#" id="forgot-back">Back to log in</a></p>
      </form>

      <form id="reset-form" style="display:none">
        <div class="field">
          <label for="reset-password">New password</label>
          <input id="reset-password" type="password" required minlength="8" autocomplete="new-password" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Set new password</button>
      </form>

      <form id="google-phone-form" style="display:none">
        <p class="sub" style="margin-top:0">Google doesn't share a phone number with us, so we just need yours to finish setting up your account.</p>
        <div class="field">
          <label for="google-phone">Phone number</label>
          <input id="google-phone" type="tel" required autocomplete="tel" />
        </div>
        <button class="btn btn-primary" type="submit" style="width:100%;justify-content:center">Finish creating account</button>
      </form>

      <div id="passkey-offer-panel" style="display:none">
        <p style="line-height:1.6;margin-top:0">Log in faster next time with your fingerprint or face, instead of typing your password.</p>
        <button class="btn btn-primary" type="button" id="passkey-offer-yes" style="width:100%;justify-content:center">Set up fingerprint / Face ID</button>
        <button class="btn btn-ghost" type="button" id="passkey-offer-no" style="width:100%;justify-content:center;margin-top:8px">Not now</button>
      </div>
      <div id="pending-panel" style="display:none">
        <p id="pending-message" style="line-height:1.6;margin-top:0"></p>
        <button class="btn btn-primary" type="button" id="pending-ok-btn" style="width:100%;justify-content:center">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  // "Show" / "Hide" toggle on every password box.
  wrap.querySelectorAll('input[type="password"]').forEach((input) => {
    const box = document.createElement('div');
    box.className = 'password-wrap';
    input.parentNode.insertBefore(box, input);
    box.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'password-toggle';
    btn.textContent = 'Show';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.setAttribute('aria-pressed', String(show));
    });
    box.appendChild(btn);
  });

  wrap.querySelector('.close-x').addEventListener('click', closeAuthModal);
  wrap.querySelector('#pending-ok-btn').addEventListener('click', closeAuthModal);

  wrap.querySelector('#passkey-login-btn').addEventListener('click', async () => {
    hideAuthError();
    try {
      const user = await loginWithPasskey();
      if (!user) return; // cancelled at the fingerprint / face prompt
      currentUser = user;
      afterAuthSuccess();
    } catch (err) {
      showAuthError(err.message);
    }
  });
  wrap.querySelector('#passkey-offer-yes').addEventListener('click', async () => {
    hideAuthError();
    try {
      const result = await setUpPasskey();
      if (result === 'cancelled') return; // they can try again or pick "Not now"
      finishAuth();
    } catch (err) {
      showAuthError(err.message);
    }
  });
  wrap.querySelector('#passkey-offer-no').addEventListener('click', () => {
    lsSet(passkeyDismissedKey(currentUser.id), String(Date.now()));
    finishAuth();
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeAuthModal(); });

  wrap.querySelector('#switch-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthMode('register');
  });
  wrap.querySelector('#switch-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthMode('login');
  });

  wrap.querySelector('#switch-to-forgot').addEventListener('click', (e) => {
    e.preventDefault();
    const typed = document.getElementById('login-email').value;
    showAuthMode('forgot');
    if (typed) document.getElementById('forgot-email').value = typed;
  });
  wrap.querySelector('#forgot-back').addEventListener('click', (e) => {
    e.preventDefault();
    showAuthMode('login');
  });
  wrap.querySelector('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    try {
      await Api.forgotPassword(document.getElementById('forgot-email').value);
      const sub = document.getElementById('auth-modal-sub');
      sub.textContent = 'If there is an account for that email, we have sent a link to reset your password. It works for one hour.';
    } catch (err) {
      showAuthError(err.message);
    }
  });
  wrap.querySelector('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    try {
      const { user } = await Api.resetPassword(resetToken, document.getElementById('reset-password').value);
      history.replaceState(null, '', location.pathname);
      resetToken = null;
      currentUser = user;
      afterAuthSuccess();
    } catch (err) {
      showAuthError(err.message);
    }
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
      const result = await Api.register({
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        phone: document.getElementById('reg-phone').value,
        password: document.getElementById('reg-password').value,
      });
      afterSignUp(result);
    } catch (err) {
      showAuthError(err.message);
    }
  });

  wrap.querySelector('#google-phone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthError();
    if (!pendingGoogleSignup) {
      showAuthError('That sign-up has expired — please start again.');
      return;
    }
    try {
      const result = await Api.googleCompleteSignUp(
        pendingGoogleSignup.token,
        document.getElementById('google-phone').value
      );
      pendingGoogleSignup = null;
      afterSignUp(result);
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
    refreshAuthDivider();
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

// The "or" line between the sign-in buttons and the email form: only while
// choosing how to sign in, and only if at least one button is showing.
function refreshAuthDivider() {
  const divider = document.getElementById('auth-divider');
  const phoneForm = document.getElementById('google-phone-form');
  if (!divider || !phoneForm) return;
  const choosing = ['google-phone-form', 'forgot-form', 'reset-form', 'pending-panel', 'passkey-offer-panel'].every((id) => document.getElementById(id).style.display === 'none');
  const passkeyShowing = document.getElementById('passkey-login-section').style.display !== 'none';
  divider.style.display = (choosing && (googleSignInAvailable === true || passkeyShowing)) ? '' : 'none';
}

let resetToken = null;

function showAuthMode(mode) {
  const modal = document.getElementById('auth-modal');
  const isLogin = mode === 'login';
  const isGooglePhone = mode === 'google-phone';
  const isForgot = mode === 'forgot';
  const isReset = mode === 'reset';
  const isPending = mode === 'pending';
  const isPasskeyOffer = mode === 'passkey-offer';
  const plain = isForgot || isReset || isPending || isPasskeyOffer; // no Google button / "or" divider

  modal.querySelector('#login-form').style.display = !isGooglePhone && !plain && isLogin ? 'block' : 'none';
  modal.querySelector('#register-form').style.display = !isGooglePhone && !plain && !isLogin ? 'block' : 'none';
  modal.querySelector('#google-phone-form').style.display = isGooglePhone ? 'block' : 'none';
  modal.querySelector('#forgot-form').style.display = isForgot ? 'block' : 'none';
  modal.querySelector('#reset-form').style.display = isReset ? 'block' : 'none';
  modal.querySelector('#pending-panel').style.display = isPending ? 'block' : 'none';
  modal.querySelector('#passkey-offer-panel').style.display = isPasskeyOffer ? 'block' : 'none';
  // Fingerprint / Face ID button: on the login screen only, and only on
  // devices that have it (checked once, then remembered).
  const passkeySection = modal.querySelector('#passkey-login-section');
  passkeySection.style.display = (isLogin && passkeyLoginAvailable()) ? '' : 'none';
  if (isLogin && passkeySupport === null) {
    passkeysSupported().then((ok) => {
      if (ok && passkeyLoginAvailable() && modal.querySelector('#login-form').style.display !== 'none') {
        passkeySection.style.display = '';
        refreshAuthDivider();
      }
    });
  }
  // The Google button + divider only make sense while picking how to sign
  // in — not mid-way through finishing a Google sign-up, and not at all if
  // it turned out not to be available (googleSignInAvailable === false).
  if (googleSignInAvailable !== false) {
    modal.querySelector('#google-signin-section').style.display = (isGooglePhone || plain) ? 'none' : '';
  }
  // "or" divider only while picking how to sign in, and only if at least one
  // sign-in button is actually showing.
  refreshAuthDivider();

  if (isPasskeyOffer) {
    modal.querySelector('#auth-modal-title').textContent = 'Use fingerprint / Face ID?';
    modal.querySelector('#auth-modal-sub').textContent = '';
  } else if (isPending) {
    modal.querySelector('#auth-modal-title').textContent = 'Thanks for signing up';
    modal.querySelector('#auth-modal-sub').textContent = '';
    modal.querySelector('#pending-message').textContent = pendingApprovalMessage;
  } else if (isForgot) {
    modal.querySelector('#auth-modal-title').textContent = 'Reset your password';
    modal.querySelector('#auth-modal-sub').textContent = "Enter your email and we'll send you a link to choose a new password.";
  } else if (isReset) {
    modal.querySelector('#auth-modal-title').textContent = 'Choose a new password';
    modal.querySelector('#auth-modal-sub').textContent = 'At least 8 characters.';
  } else if (isGooglePhone) {
    modal.querySelector('#auth-modal-title').textContent = 'One more thing';
    modal.querySelector('#auth-modal-sub').textContent = `Welcome, ${pendingGoogleSignup ? pendingGoogleSignup.name.split(' ')[0] : 'there'}.`;
  } else {
    modal.querySelector('#auth-modal-title').textContent = isLogin ? 'Log in' : 'Create your account';
    modal.querySelector('#auth-modal-sub').textContent = isLogin
      ? 'Log in to book your stay at Mirador de Calahonda.'
      : "The flat is only for family and friends, so once you've signed up Ali will check and approve your account before you can book.";
  }
  hideAuthError();
}

// "Log in" / "Book Now" while logged out: the login popup opens, and on a
// device where fingerprint / Face ID is set up, its prompt opens straight
// away on top. Dismissing that prompt (Back, or tapping outside it) leaves
// the popup's email/password and Google options right there, for logging
// in as someone else.
async function startLogin() {
  openAuthModal('login');
  if (!passkeyLoginAvailable()) return;
  try {
    const user = await loginWithPasskey();
    if (user) {
      currentUser = user;
      afterAuthSuccess();
    }
  } catch (err) {
    showAuthError(err.message);
  }
}

function openAuthModal(mode) {
  buildAuthModal();
  showAuthMode(mode || 'login');
  document.getElementById('auth-modal').classList.add('open');
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  // Closing the fingerprint / Face ID offer still finishes logging in.
  if (modal.querySelector('#passkey-offer-panel').style.display === 'block' && currentUser) {
    finishAuth();
    return;
  }
  modal.classList.remove('open');
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

// A new account either logs straight in (admins) or waits for Ali to
// approve it — in which case say so, rather than logging them in.
function afterSignUp(result) {
  if (result && result.pending) {
    pendingApprovalMessage = result.message;
    showAuthMode('pending');
    return;
  }
  currentUser = result.user;
  afterAuthSuccess();
}
let pendingApprovalMessage = '';

// After any login: offer fingerprint / Face ID if this device can do it and
// it isn't set up here yet (and they haven't said "Not now" recently).
async function afterAuthSuccess() {
  if (await shouldOfferPasskey()) {
    buildAuthModal();
    showAuthMode('passkey-offer');
    document.getElementById('auth-modal').classList.add('open');
    return;
  }
  finishAuth();
}

function finishAuth() {
  const offer = document.getElementById('passkey-offer-panel');
  if (offer) offer.style.display = 'none';
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

// Keep --header-h (and --jump-h on Things to do) matching the sticky bars'
// real heights, which change with screen width and the account buttons —
// anchor jumps and the jump bar's position are worked out from them.
function trackStickyHeights() {
  const root = document.documentElement;
  const header = document.querySelector('.site-header');
  const jump = document.querySelector('.todo-jump-bar');
  const update = () => {
    if (header) root.style.setProperty('--header-h', header.offsetHeight + 'px');
    if (jump) root.style.setProperty('--jump-h', jump.offsetHeight + 'px');
  };
  update();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(update);
    if (header) ro.observe(header);
    if (jump) ro.observe(jump);
  } else {
    window.addEventListener('resize', update);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  trackStickyHeights();
  const params = new URLSearchParams(location.search);
  if (params.get('reset')) {
    resetToken = params.get('reset');
    openAuthModal('reset');
  }
  initSession();
  initMobileNav();
});
