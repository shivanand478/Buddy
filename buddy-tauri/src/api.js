// The account server. Everything that touches the network lives here, so
// pointing Buddy at a real backend is one edit.
//
// Two endpoints are expected:
//   POST {AUTH_BASE}/auth/request-code  {email}         -> 204
//   POST {AUTH_BASE}/auth/verify        {email, code}   -> { token }
//
// With AUTH_BASE empty there is no server, and the app says so rather than
// pretending a code was sent. See `localOnly` in auth.js.
export const AUTH_BASE = 'https://buddy-api.buddyapp.workers.dev';

export function hasServer() {
  return !!AUTH_BASE;
}

export function looksLikeEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
}

async function post(path, body) {
  const res = await fetch(AUTH_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.ok) return res.status === 204 ? {} : res.json();

  // Surface the server's own wording when it gives one — it knows why better
  // than a generic message does.
  let detail = '';
  try { detail = (await res.json()).error || ''; } catch (e) { /* not JSON */ }
  throw new Error(detail || `Something went wrong (${res.status}).`);
}

/** Asks the server to email a six-digit code. */
export function requestCode(email) {
  return post('/auth/request-code', { email: email.trim().toLowerCase() });
}

/** Exchanges the code for a session token. */
export function verifyCode(email, code) {
  return post('/auth/verify', { email: email.trim().toLowerCase(), code: String(code).trim() });
}

/** Ends the session server-side too, so a stolen token stops working. */
export async function signOut(token) {
  if (!AUTH_BASE || !token) return;
  await fetch(AUTH_BASE + '/auth/sign-out', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  }).catch(() => { /* signing out locally still has to succeed */ });
}

// ------------------------------------------------------------------ session

function authed(path, { method = 'GET', token, body } = {}) {
  const headers = { Authorization: 'Bearer ' + token };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(AUTH_BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (res) => {
      if (res.ok) return res.status === 204 ? {} : res.json();
      let detail = '';
      try { detail = (await res.json()).error || ''; } catch (e) { /* not JSON */ }
      const err = new Error(detail || `Something went wrong (${res.status}).`);
      err.status = res.status;
      throw err;
    });
}

/** Tells the server what to call you, so assigned tasks say who sent them. */
export function setProfile(token, name) {
  return authed('/auth/profile', { method: 'POST', token, body: { name } });
}

export function getTeam(token) {
  return authed('/team', { token });
}

export function inviteMember(token, email) {
  return authed('/team/invite', { method: 'POST', token, body: { email } });
}

export function removeMember(token, email) {
  return authed('/team/remove', { method: 'POST', token, body: { email } });
}

export function assignTask(token, task) {
  return authed('/team/assign', { method: 'POST', token, body: task });
}

/** Collects work assigned to you. The server hands each task over exactly once. */
export function fetchInbox(token) {
  return authed('/sync/inbox', { token });
}
