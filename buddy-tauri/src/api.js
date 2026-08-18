// The account server. Everything that touches the network lives here, so
// pointing Buddy at a real backend is one edit.
//
// Two endpoints are expected:
//   POST {AUTH_BASE}/auth/request-code  {email}         -> 204
//   POST {AUTH_BASE}/auth/verify        {email, code}   -> { token }
//
// With AUTH_BASE empty there is no server, and the app says so rather than
// pretending a code was sent. See `localOnly` in auth.js.
export const AUTH_BASE = '';

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
