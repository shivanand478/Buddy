// A stand-in for D1, big enough for the statements worker.js issues and no
// bigger. Rows live in plain arrays; each statement is matched by its shape.

function makeDB() {
  const t = { accounts: [], login_codes: [], sessions: [], rate_limits: [] };

  const find = (rows, key, value) => rows.find((r) => r[key] === value);

  function exec(sql, args) {
    const s = sql.replace(/\s+/g, ' ').trim();

    // ---- rate_limits
    if (s.startsWith('SELECT count, window_end FROM rate_limits'))
      return { first: find(t.rate_limits, 'bucket', args[0]) || null };
    if (s.startsWith('INSERT INTO rate_limits')) {
      const [bucket, windowEnd] = args;
      const row = find(t.rate_limits, 'bucket', bucket);
      if (row) { row.count = 1; row.window_end = windowEnd; }
      else t.rate_limits.push({ bucket, count: 1, window_end: windowEnd });
      return {};
    }
    if (s.startsWith('UPDATE rate_limits SET count = count + 1')) {
      const row = find(t.rate_limits, 'bucket', args[0]);
      if (row) row.count += 1;
      return {};
    }
    if (s.startsWith('DELETE FROM rate_limits WHERE window_end <')) {
      t.rate_limits = t.rate_limits.filter((r) => r.window_end >= args[0]);
      return {};
    }

    // ---- login_codes
    if (s.startsWith('INSERT INTO login_codes')) {
      const [email, hash, expires, created] = args;
      const row = find(t.login_codes, 'email', email);
      if (row) Object.assign(row, { code_hash: hash, expires_at: expires, attempts: 0, created_at: created });
      else t.login_codes.push({ email, code_hash: hash, expires_at: expires, attempts: 0, created_at: created });
      return {};
    }
    if (s.startsWith('SELECT code_hash, expires_at, attempts FROM login_codes'))
      return { first: find(t.login_codes, 'email', args[0]) || null };
    if (s.startsWith('UPDATE login_codes SET attempts = attempts + 1')) {
      const row = find(t.login_codes, 'email', args[0]);
      if (row) row.attempts += 1;
      return {};
    }
    if (s.startsWith('DELETE FROM login_codes WHERE email =')) {
      t.login_codes = t.login_codes.filter((r) => r.email !== args[0]);
      return {};
    }
    if (s.startsWith('DELETE FROM login_codes WHERE expires_at <')) {
      t.login_codes = t.login_codes.filter((r) => r.expires_at >= args[0]);
      return {};
    }

    // ---- accounts
    if (s.startsWith('INSERT INTO accounts')) {
      const [email, created, seen] = args;
      const row = find(t.accounts, 'email', email);
      if (row) row.last_seen = seen;
      else t.accounts.push({ email, name: null, created_at: created, last_seen: seen });
      return {};
    }
    if (s.startsWith('SELECT name FROM accounts'))
      return { first: find(t.accounts, 'email', args[0]) || null };
    if (s.startsWith('UPDATE accounts SET last_seen')) {
      const row = find(t.accounts, 'email', args[1]);
      if (row) row.last_seen = args[0];
      return {};
    }

    // ---- sessions
    if (s.startsWith('INSERT INTO sessions')) {
      const [hash, email, created, expires] = args;
      t.sessions.push({ token_hash: hash, email, created_at: created, expires_at: expires });
      return {};
    }
    if (s.startsWith('SELECT email, expires_at FROM sessions'))
      return { first: find(t.sessions, 'token_hash', args[0]) || null };
    if (s.startsWith('DELETE FROM sessions WHERE token_hash =')) {
      t.sessions = t.sessions.filter((r) => r.token_hash !== args[0]);
      return {};
    }
    if (s.startsWith('DELETE FROM sessions WHERE expires_at <')) {
      t.sessions = t.sessions.filter((r) => r.expires_at >= args[0]);
      return {};
    }

    throw new Error('mock-d1: unhandled statement -> ' + s);
  }

  function prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => exec(sql, args).first ?? null,
      run: async () => { exec(sql, args); return { success: true }; },
      _apply: () => exec(sql, args)
    };
    return stmt;
  }

  return {
    tables: t,
    prepare,
    batch: async (stmts) => { stmts.forEach((s) => s._apply()); return []; }
  };
}
