/**
 * Buddy's account server — one file, no build step, no dependencies.
 *
 * Paste it into the Cloudflare Workers editor, bind a D1 database as `DB`,
 * add the secrets listed in README.md, and it runs.
 *
 * Endpoints
 *   POST /auth/request-code  { email }          -> 204
 *   POST /auth/verify        { email, code }    -> { token, email, name }
 *   GET  /auth/me            Bearer token       -> { email, name }
 *   POST /auth/sign-out      Bearer token       -> 204
 *   GET  /health                                -> { ok: true }
 *
 * Two rules the whole design rests on:
 *   1. Never store a secret you could read back. Codes and tokens are stored
 *      only as SHA-256 hashes.
 *   2. Never tell a stranger whether an address has an account. Signing up and
 *      logging in are the same request and give the same answer.
 */

const CODE_TTL_MS = 10 * 60 * 1000;        // a code is good for ten minutes
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;                     // wrong guesses before a code dies
const RATE = {
  email: { limit: 5, windowMs: 60 * 60 * 1000 },   // codes per address per hour
  ip: { limit: 20, windowMs: 60 * 60 * 1000 }      // codes per IP per hour
};

// ------------------------------------------------------------------ helpers

const CORS = {
  // The desktop app's origin is tauri://localhost or http://tauri.localhost
  // depending on platform, and there are no cookies involved — every call
  // carries its own bearer token — so a wildcard is the honest setting here.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

function noContent() {
  return new Response(null, { status: 204, headers: CORS });
}

function fail(status, error) {
  return json({ error }, status);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

/** Six digits, uniformly distributed — no modulo bias, no Math.random. */
function makeCode() {
  const buf = new Uint32Array(1);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= 4294000000);          // reject the ragged tail
  return String(n % 1000000).padStart(6, '0');
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare, so a wrong hash can't be found byte by byte. */
function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Returns true when the caller is still inside its budget. */
async function underLimit(db, bucket, { limit, windowMs }, now) {
  const row = await db.prepare('SELECT count, window_end FROM rate_limits WHERE bucket = ?')
    .bind(bucket).first();

  if (!row || row.window_end < now) {
    await db.prepare(
      `INSERT INTO rate_limits (bucket, count, window_end) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, window_end = excluded.window_end`
    ).bind(bucket, now + windowMs).run();
    return true;
  }
  if (row.count >= limit) return false;

  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run();
  return true;
}

/** Expired rows are swept opportunistically; nothing here needs a cron. */
async function sweep(db, now) {
  await db.batch([
    db.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE window_end < ?').bind(now)
  ]);
}

// ------------------------------------------------------------------ email

function emailBody(code, appName) {
  const text =
`Your ${appName} code is ${code}

Type it into the app to finish signing in. It expires in 10 minutes.

If you didn't ask for this, you can ignore this email — nobody can get
in without the code.`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:0 auto;padding:28px 24px;color:#14313A">
  <p style="font-size:15px;margin:0 0 18px">Here's your code to sign in to ${appName}.</p>
  <div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:34px;letter-spacing:.22em;font-weight:700;background:#FBF8F1;border:1px solid #E7DFD0;border-radius:12px;padding:18px;text-align:center">${code}</div>
  <p style="font-size:13.5px;color:#5C6B70;margin:18px 0 0">It expires in 10 minutes.</p>
  <p style="font-size:13.5px;color:#5C6B70;margin:10px 0 0">If you didn't ask for this, you can ignore this email — nobody can get in without the code.</p>
</div>`;

  return { text, html };
}

/**
 * Sends through Brevo, whose free tier allows 300 emails a day and — unlike
 * most providers — will verify a single sender address without a domain.
 */
async function sendCode(env, to, code) {
  const appName = env.APP_NAME || 'Buddy';
  const { text, html } = emailBody(code, appName);

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: env.SENDER_EMAIL, name: appName },
      to: [{ email: to }],
      subject: `${code} is your ${appName} code`,
      textContent: text,
      htmlContent: html
    })
  });

  if (!res.ok) {
    // Brevo's message is far more useful than a generic failure, but it is for
    // the logs — the caller gets something plain.
    console.error('brevo', res.status, await res.text().catch(() => ''));
    throw new Error('email-failed');
  }
}

// ------------------------------------------------------------------ routes

async function requestCodeRoute(request, env, now) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return fail(400, "That doesn't look like an email address.");

  if (!env.BREVO_API_KEY || !env.SENDER_EMAIL) {
    return fail(503, 'This server has no email provider configured yet.');
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await underLimit(env.DB, 'email:' + email, RATE.email, now))) {
    return fail(429, "That's a lot of codes. Try again in an hour.");
  }
  if (!(await underLimit(env.DB, 'ip:' + ip, RATE.ip, now))) {
    return fail(429, 'Too many requests from this network. Try again in an hour.');
  }

  const code = makeCode();
  await env.DB.prepare(
    `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET
       code_hash = excluded.code_hash,
       expires_at = excluded.expires_at,
       attempts = 0,
       created_at = excluded.created_at`
  ).bind(email, await sha256(email + ':' + code), now + CODE_TTL_MS, now).run();

  try {
    await sendCode(env, email, code);
  } catch (e) {
    // Don't leave a live code behind for an email that never arrived.
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return fail(502, "We couldn't send the email just now. Try again in a minute.");
  }

  return noContent();
}

async function verifyRoute(request, env, now) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').trim();

  if (!validEmail(email) || !/^\d{6}$/.test(code)) {
    return fail(400, 'That code didn\'t work.');
  }

  const row = await env.DB.prepare(
    'SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?'
  ).bind(email).first();

  if (!row) return fail(400, 'Ask for a new code — that one is gone.');
  if (row.expires_at < now) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return fail(400, 'That code has expired. Ask for a new one.');
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    return fail(429, 'Too many tries. Ask for a new code.');
  }

  const given = await sha256(email + ':' + code);
  if (!sameSecret(given, row.code_hash)) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?')
      .bind(email).run();
    const left = MAX_ATTEMPTS - (row.attempts + 1);
    return fail(401, left > 0
      ? `That code didn't work. ${left} ${left === 1 ? 'try' : 'tries'} left.`
      : "That code didn't work. Ask for a new one.");
  }

  const token = makeToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email),
    env.DB.prepare(
      `INSERT INTO accounts (email, created_at, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET last_seen = excluded.last_seen`
    ).bind(email, now, now),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(await sha256(token), email, now, now + SESSION_TTL_MS)
  ]);

  const account = await env.DB.prepare('SELECT name FROM accounts WHERE email = ?')
    .bind(email).first();

  return json({ token, email, name: account?.name || null });
}

async function sessionFor(request, env, now) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const row = await env.DB.prepare(
    'SELECT email, expires_at FROM sessions WHERE token_hash = ?'
  ).bind(await sha256(token)).first();

  if (!row || row.expires_at < now) return null;
  return row.email;
}

async function meRoute(request, env, now) {
  const email = await sessionFor(request, env, now);
  if (!email) return fail(401, 'Not signed in.');

  await env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE email = ?').bind(now, email).run();
  const account = await env.DB.prepare('SELECT name FROM accounts WHERE email = ?')
    .bind(email).first();
  return json({ email, name: account?.name || null });
}

async function signOutRoute(request, env, now) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(token)).run();
  }
  return noContent();
}

// ------------------------------------------------------------------ entry

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const route = request.method + ' ' + url.pathname;
    const now = Date.now();

    if (route === 'GET /health') return json({ ok: true });

    if (!env.DB) return fail(500, 'This server has no database bound.');

    try {
      let response;
      switch (route) {
        case 'POST /auth/request-code': response = await requestCodeRoute(request, env, now); break;
        case 'POST /auth/verify':       response = await verifyRoute(request, env, now); break;
        case 'GET /auth/me':            response = await meRoute(request, env, now); break;
        case 'POST /auth/sign-out':     response = await signOutRoute(request, env, now); break;
        default:                        response = fail(404, 'No such endpoint.');
      }

      // Housekeeping rides along with real traffic rather than a scheduled job,
      // but only *after* the handler has read what it needs. Sweeping first
      // races the route: an expired code would sometimes be deleted before the
      // handler saw it, and the user would get "that one is gone" instead of
      // "that code has expired" at random.
      ctx.waitUntil(sweep(env.DB, now).catch(() => {}));
      return response;
    } catch (e) {
      console.error('unhandled', route, e && e.stack);
      return fail(500, 'Something went wrong on our side.');
    }
  }
};
