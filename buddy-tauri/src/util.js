// Small helpers shared by every window.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** `YYYY-MM-DD` for local today. */
export const todayStr = () => new Date().toLocaleDateString('en-CA');

export const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** `HH:MM` -> minutes from midnight, or null. */
export function parseHHMM(t) {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/** Minutes from midnight -> "4:30 PM". */
export function label(mins) {
  if (mins == null) return '';
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** `HH:MM` -> "4:30 PM". */
export const hhmmLabel = (t) => label(parseHHMM(t));

/**
 * A unique id. `crypto.randomUUID` only exists in a secure context, so fall
 * back to random bytes (and finally Math.random) rather than throwing.
 */
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
