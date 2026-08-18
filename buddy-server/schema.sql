-- Buddy's account store. Paste this into the D1 console once.
--
-- Design notes:
--   * Codes and session tokens are stored as SHA-256 hashes. A dump of this
--     database lets nobody sign in as anybody.
--   * Every table that grows without bound carries an expiry, and the worker
--     sweeps expired rows on the way past, so the free tier stays free.

CREATE TABLE IF NOT EXISTS accounts (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

-- One live login code per email. Requesting a new one replaces the old.
CREATE TABLE IF NOT EXISTS login_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions (expires_at);

-- Rate limiting. `bucket` is "email:someone@x.com" or "ip:1.2.3.4".
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket      TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  window_end  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_window ON rate_limits (window_end);

-- ---------------------------------------------------------------- teams

CREATE TABLE IF NOT EXISTS teams (
  id           TEXT PRIMARY KEY,
  owner_email  TEXT NOT NULL,
  name         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS teams_owner ON teams (owner_email);

CREATE TABLE IF NOT EXISTS team_members (
  team_id    TEXT NOT NULL,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, email)
);
CREATE INDEX IF NOT EXISTS members_email ON team_members (email);

-- An invitation is just a claim on an address. There is no link to click and
-- no token to paste: the next time that address signs in, it joins.
CREATE TABLE IF NOT EXISTS invites (
  team_id     TEXT NOT NULL,
  email       TEXT NOT NULL,
  invited_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, email)
);
CREATE INDEX IF NOT EXISTS invites_email ON invites (email);
CREATE INDEX IF NOT EXISTS invites_expiry ON invites (expires_at);

-- A task handed to someone else, waiting for their copy of Buddy to collect it.
CREATE TABLE IF NOT EXISTS assignments (
  id                TEXT PRIMARY KEY,
  to_email          TEXT NOT NULL,
  from_email        TEXT NOT NULL,
  from_name         TEXT,
  title             TEXT NOT NULL,
  date              TEXT NOT NULL,
  time              TEXT NOT NULL,
  duration_min      INTEGER,
  remind_offset_min INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  delivered_at      INTEGER
);
CREATE INDEX IF NOT EXISTS assignments_inbox ON assignments (to_email, delivered_at);
