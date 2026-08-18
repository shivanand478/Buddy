// What the worker must get right. Each case drives the real fetch handler.

const results = [];
function check(name, condition, detail) {
  results.push({ name, ok: !!condition, detail: condition ? '' : (detail || '') });
}

let sentTo = null;
let sentCode = null;

function makeEnv() {
  return {
    DB: makeDB(),
    BREVO_API_KEY: 'key_test',
    SENDER_EMAIL: 'buddy@example.com',
    APP_NAME: 'Buddy'
  };
}

// Brevo stand-in: records the address and digs the code back out of the body,
// which is the only way the test can know what to type in.
function installFetchRecorder({ failing = false } = {}) {
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sentTo = body.to[0].email;
    sentCode = (body.subject.match(/\d{6}/) || [])[0];
    return failing
      ? { ok: false, status: 401, text: async () => 'bad key' }
      : { ok: true, status: 201, text: async () => '{}' };
  };
}

const ctx = { waitUntil: (p) => p };

function req(method, path, { body, token, ip = '1.2.3.4' } = {}) {
  const headers = { 'CF-Connecting-IP': ip };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  return new Request('https://api.test' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
}

const call = (env, ...args) => WORKER.fetch(req(...args), env, ctx);

async function run() {
  // ---------------------------------------------------------------- happy path
  {
    const env = makeEnv();
    installFetchRecorder();

    const r1 = await call(env, 'POST', '/auth/request-code', { body: { email: '  SHIV@Example.COM ' } });
    check('request-code returns 204', r1.status === 204, 'got ' + r1.status);
    check('address is normalized before sending', sentTo === 'shiv@example.com', sentTo);
    check('code is six digits', /^\d{6}$/.test(sentCode || ''), String(sentCode));

    const stored = env.DB.tables.login_codes[0];
    check('plaintext code is never stored',
      stored && stored.code_hash.length === 64 && !stored.code_hash.includes(sentCode),
      JSON.stringify(stored));

    const r2 = await call(env, 'POST', '/auth/verify', { body: { email: 'shiv@example.com', code: sentCode } });
    const v = await r2.json();
    check('verify returns a token', r2.status === 200 && /^[0-9a-f]{64}$/.test(v.token || ''), JSON.stringify(v));
    check('account was created', env.DB.tables.accounts.length === 1, JSON.stringify(env.DB.tables.accounts));
    check('code is consumed on success', env.DB.tables.login_codes.length === 0);
    check('session token is stored only as a hash',
      env.DB.tables.sessions[0] && env.DB.tables.sessions[0].token_hash !== v.token);

    const me = await call(env, 'GET', '/auth/me', { token: v.token });
    check('/auth/me recognises the token', me.status === 200 && (await me.json()).email === 'shiv@example.com');

    const anon = await call(env, 'GET', '/auth/me');
    check('/auth/me rejects no token', anon.status === 401);

    const bogus = await call(env, 'GET', '/auth/me', { token: 'f'.repeat(64) });
    check('/auth/me rejects an unknown token', bogus.status === 401);

    const out = await call(env, 'POST', '/auth/sign-out', { token: v.token });
    check('sign-out returns 204', out.status === 204);
    const after = await call(env, 'GET', '/auth/me', { token: v.token });
    check('token is dead after sign-out', after.status === 401);
  }

  // ---------------------------------------------------------------- reuse
  {
    const env = makeEnv();
    installFetchRecorder();
    await call(env, 'POST', '/auth/request-code', { body: { email: 'a@b.com' } });
    const c1 = sentCode;
    const r = await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.com', code: c1 } });
    await r.json();
    const again = await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.com', code: c1 } });
    check('a code cannot be used twice', again.status === 400, 'got ' + again.status);

    // logging in again on an existing account must not duplicate it
    await call(env, 'POST', '/auth/request-code', { body: { email: 'a@b.com' } });
    const r2 = await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.com', code: sentCode } });
    await r2.json();
    check('logging in again reuses the account', env.DB.tables.accounts.length === 1);
    check('both sessions stay valid', env.DB.tables.sessions.length === 2);
  }

  // ---------------------------------------------------------------- wrong codes
  {
    const env = makeEnv();
    installFetchRecorder();
    await call(env, 'POST', '/auth/request-code', { body: { email: 'c@d.com' } });
    const real = sentCode;
    const wrong = real === '000000' ? '111111' : '000000';

    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await call(env, 'POST', '/auth/verify', { body: { email: 'c@d.com', code: wrong } });
    }
    check('wrong code is rejected', last.status === 401, 'got ' + last.status);
    check('remaining tries are counted down',
      (await last.clone().json()).error.includes('Ask for a new one'));

    const dead = await call(env, 'POST', '/auth/verify', { body: { email: 'c@d.com', code: real } });
    check('the right code fails after too many tries', dead.status === 429, 'got ' + dead.status);
    check('a burned code is deleted', env.DB.tables.login_codes.length === 0);
  }

  // ---------------------------------------------------------------- expiry
  {
    const env = makeEnv();
    installFetchRecorder();
    await call(env, 'POST', '/auth/request-code', { body: { email: 'e@f.com' } });
    env.DB.tables.login_codes[0].expires_at = Date.now() - 1000;
    const r = await call(env, 'POST', '/auth/verify', { body: { email: 'e@f.com', code: sentCode } });
    check('an expired code is refused', r.status === 400 && (await r.json()).error.includes('expired'));
  }

  // ---------------------------------------------------------------- rate limits
  {
    const env = makeEnv();
    installFetchRecorder();
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await call(env, 'POST', '/auth/request-code', { body: { email: 'g@h.com' } });
    }
    check('sixth code request in an hour is refused', last.status === 429, 'got ' + last.status);

    // a different address from the same IP still counts toward the IP budget
    let ipLast;
    for (let i = 0; i < 20; i += 1) {
      ipLast = await call(env, 'POST', '/auth/request-code', { body: { email: `u${i}@h.com` } });
    }
    check('the IP budget also bites', ipLast.status === 429, 'got ' + ipLast.status);
  }

  // ---------------------------------------------------------------- validation
  {
    const env = makeEnv();
    installFetchRecorder();
    const bad = await call(env, 'POST', '/auth/request-code', { body: { email: 'nope' } });
    check('a malformed address is refused', bad.status === 400);

    const shortCode = await call(env, 'POST', '/auth/verify', { body: { email: 'a@b.com', code: '12' } });
    check('a malformed code is refused', shortCode.status === 400);

    const missing = await call(env, 'POST', '/auth/verify', { body: { email: 'never@seen.com', code: '123456' } });
    check('verifying with no live code is refused', missing.status === 400);

    const notFound = await call(env, 'GET', '/nope');
    check('unknown routes 404', notFound.status === 404);

    const health = await call(env, 'GET', '/health');
    check('health check answers', health.status === 200);

    const pre = await call(env, 'OPTIONS', '/auth/verify');
    check('CORS preflight answers',
      pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === '*');
  }

  // ---------------------------------------------------------------- email fails
  {
    const env = makeEnv();
    installFetchRecorder({ failing: true });
    const r = await call(env, 'POST', '/auth/request-code', { body: { email: 'i@j.com' } });
    check('a failed send reports 502', r.status === 502, 'got ' + r.status);
    check('a failed send leaves no live code behind', env.DB.tables.login_codes.length === 0);
  }

  // ---------------------------------------------------------------- misconfigured
  {
    const env = makeEnv();
    delete env.BREVO_API_KEY;
    const r = await call(env, 'POST', '/auth/request-code', { body: { email: 'k@l.com' } });
    check('missing email config is reported, not ignored', r.status === 503, 'got ' + r.status);
  }

  const failed = results.filter((r) => !r.ok);
  document.getElementById('out').innerHTML =
    results.map((r) => `<span class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ' — ' + r.detail : ''}</span>`).join('\n') +
    `\n\n${results.length - failed.length}/${results.length} passed`;
  window.__RESULT__ = { total: results.length, failed: failed.map((f) => f.name + ' — ' + f.detail) };
}

run().catch((e) => {
  document.getElementById('out').textContent = 'harness threw: ' + e.stack;
  window.__RESULT__ = { total: 0, failed: ['harness threw: ' + e.message] };
});
