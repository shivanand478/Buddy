import { installSprite, buddyArt } from './characters.js';
import { esc } from './util.js';
import { hasServer, looksLikeEmail, requestCode, verifyCode } from './api.js';

const { invoke } = window.__TAURI__.core;

installSprite();

let data = null;
let screen = 'welcome';       // welcome | email | code | local
let mode = 'signup';          // signup | login
let email = '';
let error = '';
let sending = false;
let resendAt = 0;             // epoch ms until which "Resend" stays disabled

const el = (id) => document.getElementById(id);
const pane = () => el('pane');

// ---------------------------------------------------------------- screens

const SCREENS = {
  // Choose a door. Both lead to the same email step — the wording just sets
  // the expectation of what happens at the end of it.
  welcome: () => ({
    back: false,
    html: `
      <div class="mark">${buddyArt(data.prefs.character)}</div>
      <h2>Conviea</h2>
      <p class="sub">A little companion that reminds you when it's time.
      Your account keeps your day in sync and lets your team send you things.</p>
      <div class="stack">
        <button class="btn btn-primary" data-go="signup">Create an account</button>
        <button class="btn" data-go="login">I already have one</button>
      </div>`,
    onMount() {
      pane().querySelectorAll('[data-go]').forEach((b) =>
        b.addEventListener('click', () => { mode = b.dataset.go; go('email'); }));
    }
  }),

  email: () => ({
    back: true,
    html: `
      <h2>${mode === 'signup' ? "What's your email?" : 'Welcome back.'}</h2>
      <p class="sub">${hasServer()
        ? "We'll send a six-digit code to make sure it's really you. No password to remember."
        : 'Conviea uses your email to identify you to your team.'}</p>
      <input class="email-in" id="authEmail" type="email" inputmode="email"
             placeholder="you@example.com" value="${esc(email)}"
             autocomplete="email" autocapitalize="off" spellcheck="false">
      <div class="err" id="authErr">${esc(error)}</div>
      <button class="btn btn-primary" id="authGo" style="width:280px;justify-content:center">
        ${hasServer() ? 'Send me a code' : 'Continue'}
      </button>
      ${hasServer() ? '' : `
        <div class="note">
          <strong>No account server is configured yet.</strong><br>
          Conviea will keep this email on this computer only — nothing is sent,
          and nothing is verified. Team invites need the server.
        </div>`}`,
    onMount() {
      const input = el('authEmail');
      input.focus();
      input.addEventListener('input', (e) => { email = e.target.value; clearError(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitEmail(); });
      el('authGo').addEventListener('click', submitEmail);
    }
  }),

  code: () => ({
    back: true,
    html: `
      <h2>Check your email.</h2>
      <p class="sub">We sent a six-digit code to <strong>${esc(email)}</strong>.
      It expires in 10 minutes.</p>
      <div class="code" id="codeBoxes">
        ${Array.from({ length: 6 }, (_, i) =>
          `<input id="d${i}" inputmode="numeric" maxlength="1" autocomplete="${i === 0 ? 'one-time-code' : 'off'}">`).join('')}
      </div>
      <div class="err" id="authErr">${esc(error)}</div>
      <button class="linky" id="resend"></button>`,
    onMount() {
      wireCodeBoxes();
      el('d0').focus();
      el('resend').addEventListener('click', resend);
      tickResend();
    }
  }),

  // Reached only when there is no server: the email is stored, and the screen
  // is honest about what that does and doesn't mean.
  local: () => ({
    back: false,
    html: `
      <div class="mark">${buddyArt(data.prefs.character)}</div>
      <h2>You're in.</h2>
      <p class="sub">Signed in as <strong>${esc(email)}</strong> on this computer.</p>
      <div class="note">
        This email hasn't been verified — there's no account server yet, so
        nothing was emailed. Everything else works. Team invites will start
        working once the server is connected, and you won't have to sign up again.
      </div>
      <button class="btn btn-primary" id="authDone" style="width:260px;justify-content:center;margin-top:6px">Continue</button>`,
    onMount() {
      el('authDone').addEventListener('click', () => saveAccount({ verified: false, localOnly: true, token: null }));
    }
  })
};

// ---------------------------------------------------------------- behaviour

function clearError() {
  if (!error) return;
  error = '';
  const box = el('authErr');
  if (box) box.textContent = '';
}

function fail(message) {
  error = message;
  const box = el('authErr');
  if (box) box.textContent = message;
}

function busy(on, labelWhenBusy) {
  sending = on;
  const btn = el('authGo');
  if (btn) {
    btn.disabled = on;
    if (on) btn.dataset.was = btn.textContent.trim();
    btn.textContent = on ? labelWhenBusy : (btn.dataset.was || btn.textContent);
  }
}

async function submitEmail() {
  if (sending) return;
  if (!looksLikeEmail(email)) { fail("That doesn't look like an email address."); return; }

  if (!hasServer()) { go('local'); return; }

  busy(true, 'Sending…');
  try {
    await requestCode(email);
    resendAt = Date.now() + 30_000;
    error = '';
    go('code');
  } catch (e) {
    busy(false);
    fail(e.message || "Couldn't reach the account server.");
  }
}

function wireCodeBoxes() {
  const boxes = Array.from({ length: 6 }, (_, i) => el('d' + i));

  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      clearError();
      if (box.value && i < 5) boxes[i + 1].focus();
      if (boxes.every((b) => b.value)) submitCode(boxes.map((b) => b.value).join(''));
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
    });
    // Pasting the whole code into any box should just work.
    box.addEventListener('paste', (e) => {
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split('').forEach((d, n) => { if (boxes[n]) boxes[n].value = d; });
      boxes[Math.min(digits.length, 5)].focus();
      if (digits.length === 6) submitCode(digits);
    });
  });
}

async function submitCode(code) {
  if (sending) return;
  sending = true;
  try {
    const res = await verifyCode(email, code);
    await saveAccount({ verified: true, localOnly: false, token: res.token || null });
  } catch (e) {
    sending = false;
    fail(e.message || "That code didn't work.");
    for (let i = 0; i < 6; i += 1) el('d' + i).value = '';
    el('d0').focus();
  }
}

async function resend() {
  if (Date.now() < resendAt) return;
  try {
    await requestCode(email);
    resendAt = Date.now() + 30_000;
    fail('');
    el('authErr').textContent = 'Sent another one.';
  } catch (e) {
    fail(e.message || "Couldn't send another code.");
  }
  tickResend();
}

/** Counts the resend cooldown down in place, so the button explains itself. */
function tickResend() {
  const btn = el('resend');
  if (!btn) return;
  const left = Math.ceil((resendAt - Date.now()) / 1000);
  if (left > 0) {
    btn.disabled = true;
    btn.textContent = `Resend code in ${left}s`;
    clearTimeout(tickResend._t);
    tickResend._t = setTimeout(tickResend, 500);
  } else {
    btn.disabled = false;
    btn.textContent = "Didn't get it? Send another";
  }
}

async function saveAccount({ verified, localOnly, token }) {
  data.account = {
    email: email.trim().toLowerCase(),
    verified,
    token,
    local_only: localOnly
  };
  await invoke('save_data', { data });
  await invoke('finish_auth');
}

// ---------------------------------------------------------------- shell

function go(name) {
  screen = name;
  error = '';
  // Each screen starts idle. Without this, backing out of a request that is
  // still in flight leaves `sending` true and the next screen's button dead.
  sending = false;
  render();
}

function render() {
  const s = SCREENS[screen]();
  pane().innerHTML = s.html;
  el('back').hidden = !s.back;
  el('legal').textContent = screen === 'welcome'
    ? 'Conviea keeps your tasks on your own computer. Your email is only used to sign in and to let your team reach you.'
    : '';
  s.onMount && s.onMount();
}

el('back').addEventListener('click', () => {
  clearTimeout(tickResend._t);
  go(screen === 'code' ? 'email' : 'welcome');
});

invoke('get_data').then((d) => { data = d; render(); });
