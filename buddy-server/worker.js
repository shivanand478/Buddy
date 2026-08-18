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
 *   POST /auth/profile       { name }           -> { email, name }
 *   GET  /health                                -> { ok: true }
 *
 *   GET  /team               Bearer             -> { team, members, invites }
 *   POST /team/invite        { email }          -> { invited }
 *   POST /team/remove        { email }          -> 204
 *   POST /team/assign        { email, title, date, time, ... } -> { id }
 *   GET  /sync/inbox         Bearer             -> { tasks: [...] }
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
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE = {
  email: { limit: 5, windowMs: 60 * 60 * 1000 },   // codes per address per hour
  ip: { limit: 20, windowMs: 60 * 60 * 1000 },     // codes per IP per hour
  invite: { limit: 20, windowMs: 24 * 60 * 60 * 1000 }  // invites per account per day
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
    db.prepare('DELETE FROM rate_limits WHERE window_end < ?').bind(now),
    db.prepare('DELETE FROM invites WHERE expires_at < ?').bind(now),
    // Delivered work is the app's problem from then on; 30 days is plenty of
    // room to notice a sync bug before the evidence is gone.
    db.prepare('DELETE FROM assignments WHERE delivered_at IS NOT NULL AND delivered_at < ?')
      .bind(now - 30 * 24 * 60 * 60 * 1000)
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

function inviteBody(inviter, appName, siteUrl) {
  const who = inviter || 'A teammate';
  const text =
`${who} added you to their ${appName} team.

${appName} is a little desktop companion that reminds you when it's time to do
something. When ${who} assigns you a task, it shows up on your screen at the
time they picked.

1. Download it: ${siteUrl}
2. Sign in with this email address — that's what joins you to the team.

Nothing else to do. If you weren't expecting this, you can ignore it.`;

  const html =
`<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:28px 24px;color:#14313A">
  <p style="font-size:16px;margin:0 0 16px"><strong>${who}</strong> added you to their ${appName} team.</p>
  <p style="font-size:14.5px;line-height:1.6;color:#3E5158;margin:0 0 20px">
    ${appName} is a little desktop companion that reminds you when it's time to do something.
    When ${who} assigns you a task, it shows up on your screen at the time they picked.
  </p>
  <p style="margin:0 0 18px">
    <a href="${siteUrl}" style="display:inline-block;background:#EFB43B;color:#14313A;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px">Download ${appName}</a>
  </p>
  <p style="font-size:14px;color:#3E5158;margin:0">Then <strong>sign in with this email address</strong> — that is what joins you to the team.</p>
  <p style="font-size:12.5px;color:#5C6B70;margin:18px 0 0">If you weren't expecting this, you can ignore it.</p>
</div>`;

  return { text, html };
}

/**
 * Email providers, in the order they are tried. The first one whose key is
 * present wins, so switching provider is a matter of adding a different secret
 * — no code change, no redeploy.
 *
 * All four have a free tier. The one that matters when picking: Brevo, Mailjet
 * and SendGrid will verify a single sender address, so a Gmail address is
 * enough. Resend's free tier without a domain can only email the account
 * owner, which is fine for testing and useless for real users.
 */
const PROVIDERS = [
  {
    name: 'brevo',
    ready: (env) => !!env.BREVO_API_KEY,
    send: (env, to, subject, text, html) => ({
      url: 'https://api.brevo.com/v3/smtp/email',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: {
        sender: { email: env.SENDER_EMAIL, name: env.APP_NAME || 'Buddy' },
        to: [{ email: to }],
        subject, textContent: text, htmlContent: html
      }
    })
  },
  {
    name: 'resend',
    ready: (env) => !!env.RESEND_API_KEY,
    send: (env, to, subject, text, html) => ({
      url: 'https://api.resend.com/emails',
      headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: { from: `${env.APP_NAME || 'Buddy'} <${env.SENDER_EMAIL}>`, to: [to], subject, text, html }
    })
  },
  {
    name: 'mailjet',
    ready: (env) => !!(env.MAILJET_API_KEY && env.MAILJET_SECRET),
    send: (env, to, subject, text, html) => ({
      url: 'https://api.mailjet.com/v3.1/send',
      headers: {
        Authorization: 'Basic ' + btoa(`${env.MAILJET_API_KEY}:${env.MAILJET_SECRET}`),
        'Content-Type': 'application/json'
      },
      body: {
        Messages: [{
          From: { Email: env.SENDER_EMAIL, Name: env.APP_NAME || 'Buddy' },
          To: [{ Email: to }], Subject: subject, TextPart: text, HTMLPart: html
        }]
      }
    })
  },
  {
    name: 'sendgrid',
    ready: (env) => !!env.SENDGRID_API_KEY,
    send: (env, to, subject, text, html) => ({
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: { Authorization: 'Bearer ' + env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
      body: {
        personalizations: [{ to: [{ email: to }] }],
        from: { email: env.SENDER_EMAIL, name: env.APP_NAME || 'Buddy' },
        subject,
        content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }]
      }
    })
  }
];

function activeProvider(env) {
  return PROVIDERS.find((p) => p.ready(env)) || null;
}

/** One place that talks to whichever provider is configured. */
async function send(env, to, subject, text, html) {
  const provider = activeProvider(env);
  if (!provider) throw new Error('no-provider');
  if (!env.SENDER_EMAIL) throw new Error('no-sender');

  const req = provider.send(env, to, subject, text, html);
  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body)
  });

  if (!res.ok) {
    // The provider's own words are far more useful than a generic failure, but
    // they belong in the logs — the caller gets something a person can read.
    console.error(provider.name, res.status, await res.text().catch(() => ''));
    throw new Error('email-failed');
  }
}

async function sendCode(env, to, code) {
  const appName = env.APP_NAME || 'Buddy';
  const { text, html } = emailBody(code, appName);
  await send(env, to, `${code} is your ${appName} code`, text, html);
}

async function sendInvite(env, to, inviterName) {
  const appName = env.APP_NAME || 'Buddy';
  const site = env.SITE_URL || 'https://shivanand478.github.io/Buddy/';
  const { text, html } = inviteBody(inviterName, appName, site);
  await send(env, to, `${inviterName || 'A teammate'} added you to their ${appName} team`, text, html);
}

// ------------------------------------------------------------------ routes

async function requestCodeRoute(request, env, now) {
  const body = await request.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return fail(400, "That doesn't look like an email address.");

  if (!activeProvider(env) || !env.SENDER_EMAIL) {
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

  // An invitation is a claim on an address, so signing in is what redeems it.
  // Nothing to click, nothing to paste, and an invite sent before the person
  // ever heard of Buddy still works whenever they get round to it.
  await claimInvites(env.DB, email, now);

  const account = await env.DB.prepare('SELECT name FROM accounts WHERE email = ?')
    .bind(email).first();

  return json({ token, email, name: account?.name || null });
}

async function claimInvites(db, email, now) {
  // Only a real account can join a team. Without this an invitation would make
  // a member out of an address that has never signed in — and that member could
  // then be assigned work they will never see.
  const account = await db.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
  if (!account) return;

  const pending = await db.prepare(
    'SELECT team_id FROM invites WHERE email = ? AND expires_at > ?'
  ).bind(email, now).all();

  const rows = pending?.results || [];
  if (!rows.length) return;

  await db.batch([
    ...rows.map((r) => db.prepare(
      `INSERT INTO team_members (team_id, email, role, joined_at) VALUES (?, ?, 'member', ?)
       ON CONFLICT(team_id, email) DO NOTHING`
    ).bind(r.team_id, email, now)),
    db.prepare('DELETE FROM invites WHERE email = ?').bind(email)
  ]);
}

/** The team this account owns, created the first time it is needed. */
async function ownTeam(db, email, now) {
  const existing = await db.prepare('SELECT id, name FROM teams WHERE owner_email = ?')
    .bind(email).first();
  if (existing) return existing;

  const id = makeToken().slice(0, 24);
  await db.batch([
    db.prepare('INSERT INTO teams (id, owner_email, name, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, email, null, now),
    db.prepare(`INSERT INTO team_members (team_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)
                ON CONFLICT(team_id, email) DO NOTHING`).bind(id, email, now)
  ]);
  return { id, name: null };
}

/** True when both addresses share any team — the check every assign must pass. */
async function shareTeam(db, a, b) {
  const row = await db.prepare(
    `SELECT 1 AS ok FROM team_members m1
     JOIN team_members m2 ON m1.team_id = m2.team_id
     WHERE m1.email = ? AND m2.email = ?`
  ).bind(a, b).first();
  return !!row;
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


// ------------------------------------------------------------------ profile

async function profileRoute(request, env, now) {
  const email = await sessionFor(request, env, now);
  if (!email) return fail(401, 'Not signed in.');

  const body = await request.json().catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 60);
  await env.DB.prepare('UPDATE accounts SET name = ? WHERE email = ?').bind(name || null, email).run();
  return json({ email, name: name || null });
}

// ------------------------------------------------------------------ teams

async function teamRoute(request, env, now) {
  const email = await sessionFor(request, env, now);
  if (!email) return fail(401, 'Not signed in.');

  const team = await ownTeam(env.DB, email, now);

  const members = await env.DB.prepare(
    `SELECT m.email, m.role, m.joined_at, a.name
     FROM team_members m LEFT JOIN accounts a ON a.email = m.email
     WHERE m.team_id = ? ORDER BY m.joined_at`
  ).bind(team.id).all();

  const invites = await env.DB.prepare(
    'SELECT email, created_at FROM invites WHERE team_id = ? AND expires_at > ? ORDER BY created_at'
  ).bind(team.id, now).all();

  // Teams this account was invited into by someone else.
  const partOf = await env.DB.prepare(
    `SELECT t.id, t.owner_email, a.name AS owner_name
     FROM team_members m JOIN teams t ON t.id = m.team_id
     LEFT JOIN accounts a ON a.email = t.owner_email
     WHERE m.email = ? AND t.owner_email != ?`
  ).bind(email, email).all();

  return json({
    team: { id: team.id, name: team.name },
    members: members?.results || [],
    invites: invites?.results || [],
    memberOf: partOf?.results || []
  });
}

async function inviteRoute(request, env, now) {
  const me = await sessionFor(request, env, now);
  if (!me) return fail(401, 'Not signed in.');

  if (!activeProvider(env) || !env.SENDER_EMAIL) {
    return fail(503, 'This server has no email provider configured yet.');
  }

  const body = await request.json().catch(() => ({}));
  const invitee = normalizeEmail(body.email);
  if (!validEmail(invitee)) return fail(400, "That doesn't look like an email address.");
  if (invitee === me) return fail(400, "You're already on your own team.");

  if (!(await underLimit(env.DB, 'invite:' + me, RATE.invite, now))) {
    return fail(429, "That's a lot of invitations for one day. Try again tomorrow.");
  }

  const team = await ownTeam(env.DB, me, now);

  const already = await env.DB.prepare(
    'SELECT 1 AS ok FROM team_members WHERE team_id = ? AND email = ?'
  ).bind(team.id, invitee).first();
  if (already) return json({ invited: invitee, alreadyMember: true });

  const account = await env.DB.prepare('SELECT name FROM accounts WHERE email = ?').bind(me).first();
  const inviterName = account?.name || me;

  await env.DB.prepare(
    `INSERT INTO invites (team_id, email, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(team_id, email) DO UPDATE SET created_at = excluded.created_at,
                                               expires_at = excluded.expires_at`
  ).bind(team.id, invitee, me, now, now + INVITE_TTL_MS).run();

  try {
    await sendInvite(env, invitee, inviterName);
  } catch (e) {
    await env.DB.prepare('DELETE FROM invites WHERE team_id = ? AND email = ?')
      .bind(team.id, invitee).run();
    return fail(502, "We couldn't send that invitation. Try again in a minute.");
  }

  // If they already have an account, the invite is redeemed straight away and
  // they can be assigned work without waiting for their next sign-in.
  await claimInvites(env.DB, invitee, now);

  return json({ invited: invitee });
}

async function removeRoute(request, env, now) {
  const me = await sessionFor(request, env, now);
  if (!me) return fail(401, 'Not signed in.');

  const body = await request.json().catch(() => ({}));
  const who = normalizeEmail(body.email);
  const team = await ownTeam(env.DB, me, now);
  if (who === me) return fail(400, "You can't remove yourself from your own team.");

  await env.DB.batch([
    env.DB.prepare('DELETE FROM team_members WHERE team_id = ? AND email = ?').bind(team.id, who),
    env.DB.prepare('DELETE FROM invites WHERE team_id = ? AND email = ?').bind(team.id, who)
  ]);
  return noContent();
}

async function assignRoute(request, env, now) {
  const me = await sessionFor(request, env, now);
  if (!me) return fail(401, 'Not signed in.');

  const body = await request.json().catch(() => ({}));
  const to = normalizeEmail(body.email);
  const title = String(body.title || '').trim().slice(0, 200);
  const date = String(body.date || '').trim();
  const time = String(body.time || '').trim();

  if (!validEmail(to)) return fail(400, "That doesn't look like an email address.");
  if (!title) return fail(400, 'Give the task a name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, 'That date looks wrong.');
  if (!/^\d{2}:\d{2}$/.test(time)) return fail(400, 'That time looks wrong.');

  if (to !== me && !(await shareTeam(env.DB, me, to))) {
    return fail(403, "They're not on your team yet.");
  }

  const account = await env.DB.prepare('SELECT name FROM accounts WHERE email = ?').bind(me).first();
  const id = makeToken().slice(0, 32);

  await env.DB.prepare(
    `INSERT INTO assignments
       (id, to_email, from_email, from_name, title, date, time, duration_min, remind_offset_min, created_at, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).bind(
    id, to, me, account?.name || null, title, date, time,
    Number.isFinite(body.duration_min) ? body.duration_min : null,
    Number.isFinite(body.remind_offset_min) ? body.remind_offset_min : 0,
    now
  ).run();

  return json({ id });
}

/**
 * Everything assigned to this account that its copy of Buddy has not collected.
 * Marked delivered on the way out, so a task is handed over exactly once and a
 * person who deletes it does not get it back on the next poll.
 */
async function inboxRoute(request, env, now) {
  const me = await sessionFor(request, env, now);
  if (!me) return fail(401, 'Not signed in.');

  const rows = await env.DB.prepare(
    `SELECT id, from_email, from_name, title, date, time, duration_min, remind_offset_min
     FROM assignments WHERE to_email = ? AND delivered_at IS NULL ORDER BY created_at`
  ).bind(me).all();

  const tasks = rows?.results || [];
  if (tasks.length) {
    await env.DB.prepare(
      'UPDATE assignments SET delivered_at = ? WHERE to_email = ? AND delivered_at IS NULL'
    ).bind(now, me).run();
  }
  return json({ tasks });
}

// ------------------------------------------------------------------ entry


export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const route = request.method + ' ' + url.pathname;
    const now = Date.now();

    if (route === 'GET /health') {
      const p = activeProvider(env);
      return json({ ok: true, email: p ? p.name : null, sender: env.SENDER_EMAIL || null });
    }

    if (!env.DB) return fail(500, 'This server has no database bound.');

    try {
      let response;
      switch (route) {
        case 'POST /auth/request-code': response = await requestCodeRoute(request, env, now); break;
        case 'POST /auth/verify':       response = await verifyRoute(request, env, now); break;
        case 'GET /auth/me':            response = await meRoute(request, env, now); break;
        case 'POST /auth/sign-out':     response = await signOutRoute(request, env, now); break;
        case 'POST /auth/profile':      response = await profileRoute(request, env, now); break;
        case 'GET /team':               response = await teamRoute(request, env, now); break;
        case 'POST /team/invite':       response = await inviteRoute(request, env, now); break;
        case 'POST /team/remove':       response = await removeRoute(request, env, now); break;
        case 'POST /team/assign':       response = await assignRoute(request, env, now); break;
        case 'GET /sync/inbox':         response = await inboxRoute(request, env, now); break;
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
