import { installSprite } from './characters.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

installSprite();

const el = (id) => document.getElementById(id);
const pop = el('pop');

let items = [];
let dismissTimer = null;
let hovering = false;
let dismissSeconds = 12;

// ---------------------------------------------------------------- rendering

function render(list) {
  if (!list || !list.length) return;
  // Rust already sorts, but don't let the display depend on the payload's order.
  items = [...list].sort((a, b) => (a.sort_minutes ?? 0) - (b.sort_minutes ?? 0));

  const first = items[0];
  const many = items.length > 1;

  el('kind').textContent = many ? `${items.length} things` : kindLabel(first.kind);
  el('time').textContent = many ? '' : (first.time_label || '');

  if (many) {
    // Several things due together become one popup, never a stack of windows.
    el('msg').textContent = "You've got a few things coming up. 👋";
    el('sub').textContent = '';
    el('sub').hidden = true;
    el('group').hidden = false;
    el('group').innerHTML = items.map((it, i) => `
      <div class="g-item">
        <span class="gt">${escape(it.time_label || '')}</span>
        <span class="gn">${escape(it.title)}</span>
        <button class="g-done" data-i="${i}">Done</button>
      </div>`).join('');
    el('group').querySelectorAll('.g-done').forEach((b) => {
      b.addEventListener('click', () => {
        const it = items[Number(b.dataset.i)];
        invoke('complete_item', { id: it.id, kind: it.kind });
        b.classList.add('did');
        b.textContent = 'Done ✓';
        b.disabled = true;
        if ([...el('group').querySelectorAll('.g-done')].every((x) => x.disabled)) {
          setTimeout(close, 700);
        }
      });
    });
    el('done').hidden = true;
    el('snooze').textContent = 'Snooze all';
  } else {
    el('msg').textContent = first.title;
    el('sub').textContent = first.subtitle || '';
    el('sub').hidden = !first.subtitle;
    el('group').hidden = true;
    el('done').hidden = false;
    el('snooze').textContent = 'Snooze';
  }

  el('snoozeOpts').hidden = true;
  el('acts').hidden = false;

  enter();
}

function kindLabel(k) {
  return { task: 'Task', routine: 'Routine', water: 'Water', goal: 'Goal', team: 'Team task', review: 'Weekly' }[k] || 'Reminder';
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------- lifecycle

function enter() {
  pop.classList.remove('in');
  void pop.offsetWidth;
  pop.classList.add('in');

  const ring = el('ring');
  ring.style.transition = 'none';
  ring.style.strokeDashoffset = '0';
  void ring.getBoundingClientRect();
  ring.style.transition = `stroke-dashoffset ${dismissSeconds}s linear`;
  ring.style.strokeDashoffset = '34.5';

  arm(dismissSeconds * 1000);
}

function arm(ms) {
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    if (hovering) return;      // don't vanish while the cursor is on the way
    close();
  }, ms);
}

function close() {
  clearTimeout(dismissTimer);
  pop.classList.remove('in');
  setTimeout(() => invoke('close_reminder'), 260);
}

// Hovering pauses the countdown; leaving gives a shorter grace period.
document.body.addEventListener('mouseenter', () => {
  hovering = true;
  clearTimeout(dismissTimer);
  el('ring').style.transition = 'none';
});
document.body.addEventListener('mouseleave', () => {
  hovering = false;
  arm(4000);
});

// ---------------------------------------------------------------- actions

el('done').addEventListener('click', () => {
  items.forEach((it) => invoke('complete_item', { id: it.id, kind: it.kind }));
  close();
});

el('skip').addEventListener('click', () => {
  items.forEach((it) => invoke('skip_item', { id: it.id, kind: it.kind }));
  close();
});

el('snooze').addEventListener('click', () => {
  el('acts').hidden = true;
  el('snoozeOpts').hidden = false;
  clearTimeout(dismissTimer);
});

el('snoozeOpts').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    const minutes = Number(b.dataset.min);
    items.forEach((it) => invoke('snooze_item', { id: it.id, kind: it.kind, minutes }));
    close();
  });
});

// ---------------------------------------------------------------- boot

async function boot() {
  try {
    const data = await invoke('get_data');
    dismissSeconds = data?.prefs?.dismiss_seconds || 12;
    const ch = data?.prefs?.character || 'nub';
    el('buddyUse').setAttribute('href', `#c-${ch}`);
  } catch (e) {
    console.error('buddy: could not read prefs', e);
  }

  const pending = await invoke('get_pending');
  if (pending?.length) render(pending);
}

listen('buddy://show', (event) => {
  boot().then(() => render(event.payload));
});

boot();
