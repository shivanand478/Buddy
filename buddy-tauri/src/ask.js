import { esc, hhmmLabel, newId } from './util.js';
// A task is created by answering four short questions, one screen at a time,
// instead of filling in a form. Same flow is used by the morning check-in and
// the Tasks view.

const TIME_CHOICES = [
  ['Morning',   '09:00'], ['Midday',  '12:00'], ['Afternoon', '15:00'],
  ['Late day',  '17:00'], ['Evening', '19:00'], ['Night',     '21:00']
];
const DURATIONS = [['15 min', 15], ['30 min', 30], ['1 hour', 60], ['2 hours', 120], ['Not sure', null]];
const OFFSETS = [['At the time', 0], ['15 min before', 15], ['30 min before', 30]];


/**
 * Renders the flow into `host`. Calls onCreate(task) when the last answer lands,
 * and onCancel() if the user backs out of the first question.
 */
export function askFlow(host, { onCreate, onCancel, prefillTitle = '' } = {}) {
  const draft = { title: prefillTitle, date: 'today', time: '', duration: undefined, offset: 0 };
  let step = prefillTitle ? 1 : 0;

  const steps = [
    () => `
      <div class="ask-q">What do you want to do?</div>
      <input class="ask-input" id="askTitle" placeholder="Finish the homepage" value="${esc(draft.title)}" autocomplete="off">`,

    () => `
      <div class="ask-recap">${esc(draft.title)}</div>
      <div class="ask-q">When?</div>
      <div class="opts" style="margin-bottom:10px">
        <button class="opt ${draft.date === 'today' ? 'on' : ''}" data-date="today">Today</button>
        <button class="opt ${draft.date === 'tomorrow' ? 'on' : ''}" data-date="tomorrow">Tomorrow</button>
      </div>
      <div class="opts">
        ${TIME_CHOICES.map(([n, v]) => `<button class="opt ${draft.time === v ? 'on' : ''}" data-time="${v}">${n}<br><span style="font-family:var(--font-mono);font-size:10px;opacity:.7">${hhmmLabel(v)}</span></button>`).join('')}
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:8px">
        <span class="label">or exactly</span>
        <input type="time" id="askTime" value="${draft.time || '16:30'}" style="width:130px">
      </div>`,

    () => `
      <div class="ask-recap">${esc(draft.title)} · ${draft.date === 'today' ? 'Today' : 'Tomorrow'} ${draft.time ? hhmmLabel(draft.time) : ''}</div>
      <div class="ask-q">How long will it take?</div>
      <div class="opts">
        ${DURATIONS.map(([n, v]) => `<button class="opt ${draft.duration === v ? 'on' : ''}" data-dur="${v === null ? '' : v}">${n}</button>`).join('')}
      </div>`,

    () => `
      <div class="ask-recap">${esc(draft.title)} · ${draft.date === 'today' ? 'Today' : 'Tomorrow'} ${hhmmLabel(draft.time)}${draft.duration ? ' · ' + draft.duration + ' min' : ''}</div>
      <div class="ask-q">When should I remind you?</div>
      <div class="opts">
        ${OFFSETS.map(([n, v]) => `<button class="opt ${draft.offset === v ? 'on' : ''}" data-off="${v}">${n}</button>`).join('')}
      </div>`
  ];

  function canAdvance() {
    if (step === 0) return !!draft.title.trim();
    if (step === 1) return !!draft.time;
    return true;
  }

  function render() {
    host.innerHTML = `
      <div class="ask">
        ${steps[step]()}
        <div class="ask-foot">
          <div class="ask-dots">${steps.map((_, i) => `<span class="ask-dot ${i === step ? 'on' : ''}"></span>`).join('')}</div>
          <button class="btn btn-quiet" id="askBack">${step === 0 ? 'Cancel' : 'Back'}</button>
          <button class="btn btn-primary" id="askNext">${step === steps.length - 1 ? 'Add it' : 'Next'}</button>
        </div>
      </div>`;

    const title = host.querySelector('#askTitle');
    if (title) {
      title.focus();
      title.addEventListener('input', (e) => { draft.title = e.target.value; });
      title.addEventListener('keydown', (e) => { if (e.key === 'Enter') advance(); });
    }

    host.querySelectorAll('[data-date]').forEach((b) =>
      b.addEventListener('click', () => { draft.date = b.dataset.date; render(); }));
    host.querySelectorAll('[data-time]').forEach((b) =>
      b.addEventListener('click', () => { draft.time = b.dataset.time; advance(); }));
    host.querySelectorAll('[data-dur]').forEach((b) =>
      b.addEventListener('click', () => { draft.duration = b.dataset.dur ? Number(b.dataset.dur) : null; advance(); }));
    host.querySelectorAll('[data-off]').forEach((b) =>
      b.addEventListener('click', () => { draft.offset = Number(b.dataset.off); advance(); }));

    const t = host.querySelector('#askTime');
    if (t) t.addEventListener('change', (e) => { draft.time = e.target.value; render(); });

    host.querySelector('#askNext').addEventListener('click', advance);
    host.querySelector('#askBack').addEventListener('click', () => {
      if (step === 0) { onCancel && onCancel(); return; }
      step -= 1; render();
    });
  }

  function advance() {
    if (!canAdvance()) return;
    if (step < steps.length - 1) { step += 1; render(); return; }

    const d = new Date();
    if (draft.date === 'tomorrow') d.setDate(d.getDate() + 1);
    onCreate({
      id: newId(),
      title: draft.title.trim(),
      date: d.toLocaleDateString('en-CA'),
      time: draft.time,
      duration_min: draft.duration ?? null,
      remind_offset_min: draft.offset,
      repeat: 'none',
      done: false, skipped: false,
      notes: null, assigned_by: null,
      snoozed_until: null, fired_at: null
    });
  }

  render();
}

