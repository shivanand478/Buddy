// A stand-in for D1, big enough for the statements worker.js issues and no
// bigger. Rows live in plain arrays; each statement is matched by its shape.

function makeDB() {
  const t = { accounts: [], login_codes: [], sessions: [], rate_limits: [],
              teams: [], team_members: [], invites: [], assignments: [] };

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
    if (s.startsWith('SELECT email FROM accounts'))
      return { first: find(t.accounts, 'email', args[0]) || null };
    if (s.startsWith('UPDATE accounts SET name')) {
      const row = find(t.accounts, 'email', args[1]);
      if (row) row.name = args[0];
      return {};
    }
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

    // ---- teams
    if (s.startsWith('SELECT id, name FROM teams WHERE owner_email'))
      return { first: find(t.teams, 'owner_email', args[0]) || null };
    if (s.startsWith('INSERT INTO teams')) {
      t.teams.push({ id: args[0], owner_email: args[1], name: args[2], created_at: args[3] });
      return {};
    }

    // ---- team_members
    if (s.startsWith('INSERT INTO team_members')) {
      const [team_id, email, joined_at] = args;
      const role = s.includes("'owner'") ? 'owner' : 'member';
      if (!t.team_members.some((m) => m.team_id === team_id && m.email === email))
        t.team_members.push({ team_id, email, role, joined_at });
      return {};
    }
    if (s.startsWith('SELECT 1 AS ok FROM team_members m1')) {
      const mine = t.team_members.filter((m) => m.email === args[0]).map((m) => m.team_id);
      const theirs = t.team_members.filter((m) => m.email === args[1]).map((m) => m.team_id);
      return { first: mine.some((id) => theirs.includes(id)) ? { ok: 1 } : null };
    }
    if (s.startsWith('SELECT 1 AS ok FROM team_members WHERE team_id')) {
      const row = t.team_members.find((m) => m.team_id === args[0] && m.email === args[1]);
      return { first: row ? { ok: 1 } : null };
    }
    if (s.startsWith('SELECT m.email, m.role')) {
      const rows = t.team_members.filter((m) => m.team_id === args[0])
        .sort((a, b) => a.joined_at - b.joined_at)
        .map((m) => ({ ...m, name: (find(t.accounts, 'email', m.email) || {}).name || null }));
      return { all: rows };
    }
    if (s.startsWith('SELECT t.id, t.owner_email')) {
      const rows = t.team_members.filter((m) => m.email === args[0])
        .map((m) => find(t.teams, 'id', m.team_id))
        .filter((team) => team && team.owner_email !== args[1])
        .map((team) => ({ id: team.id, owner_email: team.owner_email,
                          owner_name: (find(t.accounts, 'email', team.owner_email) || {}).name || null }));
      return { all: rows };
    }
    if (s.startsWith('DELETE FROM team_members WHERE team_id')) {
      t.team_members = t.team_members.filter((m) => !(m.team_id === args[0] && m.email === args[1]));
      return {};
    }

    // ---- invites
    if (s.startsWith('INSERT INTO invites')) {
      const [team_id, email, invited_by, created_at, expires_at] = args;
      const row = t.invites.find((i) => i.team_id === team_id && i.email === email);
      if (row) Object.assign(row, { created_at, expires_at });
      else t.invites.push({ team_id, email, invited_by, created_at, expires_at });
      return {};
    }
    if (s.startsWith('SELECT team_id FROM invites'))
      return { all: t.invites.filter((i) => i.email === args[0] && i.expires_at > args[1])
                              .map((i) => ({ team_id: i.team_id })) };
    if (s.startsWith('SELECT email, created_at FROM invites'))
      return { all: t.invites.filter((i) => i.team_id === args[0] && i.expires_at > args[1])
                              .map((i) => ({ email: i.email, created_at: i.created_at })) };
    if (s.startsWith('DELETE FROM invites WHERE email =')) {
      t.invites = t.invites.filter((i) => i.email !== args[0]);
      return {};
    }
    if (s.startsWith('DELETE FROM invites WHERE team_id')) {
      t.invites = t.invites.filter((i) => !(i.team_id === args[0] && i.email === args[1]));
      return {};
    }
    if (s.startsWith('DELETE FROM invites WHERE expires_at <')) {
      t.invites = t.invites.filter((i) => i.expires_at >= args[0]);
      return {};
    }

    // ---- assignments
    if (s.startsWith('INSERT INTO assignments')) {
      const [id, to_email, from_email, from_name, title, date, time, duration_min, remind_offset_min, created_at] = args;
      t.assignments.push({ id, to_email, from_email, from_name, title, date, time,
                           duration_min, remind_offset_min, created_at, delivered_at: null });
      return {};
    }
    if (s.startsWith('SELECT id, from_email'))
      return { all: t.assignments.filter((a) => a.to_email === args[0] && a.delivered_at === null)
                                 .sort((a, b) => a.created_at - b.created_at) };
    if (s.startsWith('UPDATE assignments SET delivered_at')) {
      t.assignments.forEach((a) => { if (a.to_email === args[1] && a.delivered_at === null) a.delivered_at = args[0]; });
      return {};
    }
    if (s.startsWith('DELETE FROM assignments')) {
      t.assignments = t.assignments.filter((a) => !(a.delivered_at !== null && a.delivered_at < args[0]));
      return {};
    }

    throw new Error('mock-d1: unhandled statement -> ' + s);
  }

  function prepare(sql) {
    let args = [];
    const stmt = {
      bind: (...a) => { args = a; return stmt; },
      first: async () => exec(sql, args).first ?? null,
      all: async () => ({ results: exec(sql, args).all || [] }),
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
