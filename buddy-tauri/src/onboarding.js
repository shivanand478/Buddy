import { installSprite, buddySvg, CHARACTERS } from './characters.js';
import { newId } from './util.js';

const { invoke } = window.__TAURI__.core;

installSprite();

const AREAS = ['Work', 'Health', 'Fitness', 'Content', 'Business', 'Study', 'Personal'];
const STARTER_ROUTINE = [
  { emoji: '☀️', title: 'Wake up', time: '08:00' },
  { emoji: '🥣', title: 'Breakfast', time: '08:30' },
  { emoji: '💻', title: 'Start work', time: '09:30' },
  { emoji: '🍱', title: 'Lunch', time: '13:30' },
  { emoji: '🏋️', title: 'Gym', time: '17:30' },
  { emoji: '🌙', title: 'Wind down', time: '22:30' }
];

let data = null;
let step = 0;
const picked = { routine: new Set(), areas: new Set(), task: '', time: '16:30' };

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SCREENS = [
  // 1 — hello
  () => `
    <div class="step center">
      ${buddySvg(data.prefs.character)}
      <h2>Meet Buddy 👋</h2>
      <p class="sub">I'll remember the things you don't want to forget — and I'll stay out of
      your way until it's time.</p>
    </div>`,

  // 2 — character
  () => `
    <h2>Pick your Buddy</h2>
    <p class="sub">This is who shows up. Pick the one you won't mind seeing every day.</p>
    <div class="char-grid" style="width:100%">
      ${CHARACTERS.map((c) => `
        <button class="char-pick ${data.prefs.character === c.id ? 'on' : ''}" data-char="${c.id}">
          ${buddySvg(c.id)}
          <span class="n">${c.name}</span>
          <span class="r">${c.role}</span>
        </button>`).join('')}
    </div>
    <p class="sub" id="charLine" style="font-style:italic"></p>`,

  // 3 — what matters
  () => `
    <h2>What matters to you?</h2>
    <p class="sub">Pick a few. This shapes what Buddy nudges you about.</p>
    <div class="areas">
      ${AREAS.map((a) => `<button class="area ${picked.areas.has(a) ? 'on' : ''}" data-area="${a}">${a}</button>`).join('')}
    </div>`,

  // 4 — routine
  () => `
    <h2>Set your routine</h2>
    <p class="sub">Optional — tick the ones you actually do. You can change the times later.</p>
    <div class="areas" style="grid-template-columns:repeat(2,1fr)">
      ${STARTER_ROUTINE.map((r, i) => `
        <button class="area ${picked.routine.has(i) ? 'on' : ''}" data-routine="${i}">
          ${r.emoji} ${r.title}
          <span style="float:right;font-family:var(--font-mono);font-size:11px;color:var(--text-dim)">${r.time}</span>
        </button>`).join('')}
    </div>`,

  // 5 — first task
  () => `
    <h2>What's one thing you need to do today?</h2>
    <p class="sub">Just one. Buddy works best when today is small.</p>
    <input id="firstTask" placeholder="Finish the homepage" value="${esc(picked.task)}" style="width:100%;font-size:16px;padding:13px 14px">`,

  // 6 — when
  () => `
    <h2>When do you want to do it?</h2>
    <p class="sub">Every task gets a time. That's what makes the reminder useful.</p>
    <input id="firstTime" type="time" value="${picked.time}" style="width:170px;font-size:18px;padding:12px 14px">
    <p class="sub">${picked.task ? `I'll remind you about "${esc(picked.task)}" then.` : 'Skip this if you left the task blank.'}</p>`,

  // 7 — done
  () => `
    <div class="step center">
      ${buddySvg(data.prefs.character)}
      <h2>You're all set.</h2>
      <p class="sub">I'll be up in the ${navigator.platform.includes('Mac') ? 'menu bar' : 'system tray'} if you need me.
      Otherwise, I'll come find you when it's time.</p>
    </div>`
];

function render() {
  const inner = SCREENS[step]();
  el('step').className = inner.includes('class="step center"') ? 'step' : 'step';
  el('step').innerHTML = inner.includes('<div class="step') ? inner.replace(/^<div class="step[^"]*">|<\/div>$/g, '') : inner;
  if (inner.includes('class="step center"')) el('step').classList.add('center');
  else el('step').classList.remove('center');

  el('dots').innerHTML = SCREENS.map((_, i) => `<span class="dot ${i === step ? 'on' : ''}"></span>`).join('');
  el('back').hidden = step === 0;
  el('next').textContent = step === SCREENS.length - 1 ? 'Start' : 'Continue';

  wire();
}

function wire() {
  el('step').querySelectorAll('[data-char]').forEach((b) => b.addEventListener('click', () => {
    data.prefs.character = b.dataset.char;
    render();
    const c = CHARACTERS.find((x) => x.id === data.prefs.character);
    const line = el('charLine');
    if (line && c) line.textContent = `"${c.line}"`;
  }));

  el('step').querySelectorAll('[data-area]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.area;
    picked.areas.has(a) ? picked.areas.delete(a) : picked.areas.add(a);
    b.classList.toggle('on');
  }));

  el('step').querySelectorAll('[data-routine]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.routine);
    picked.routine.has(i) ? picked.routine.delete(i) : picked.routine.add(i);
    b.classList.toggle('on');
  }));
}

function capture() {
  const t = el('firstTask');
  if (t) picked.task = t.value.trim();
  const tm = el('firstTime');
  if (tm) picked.time = tm.value || '16:30';
}

el('next').addEventListener('click', async () => {
  capture();
  if (step < SCREENS.length - 1) {
    step += 1;
    render();
    return;
  }
  await finish();
});

el('back').addEventListener('click', () => {
  capture();
  step = Math.max(0, step - 1);
  render();
});

async function finish() {
  data.prefs.focus_areas = [...picked.areas];
  data.prefs.onboarded = true;

  data.routine = [...picked.routine].map((i) => {
    const r = STARTER_ROUTINE[i];
    return {
      id: newId(),
      title: r.title, emoji: r.emoji, time: r.time,
      days: [], enabled: true,
      completed_on: null, skipped_on: null, snoozed_until: null, fired_at: null
    };
  });

  if (picked.task) {
    data.tasks.push({
      id: newId(),
      title: picked.task,
      date: new Date().toLocaleDateString('en-CA'),
      time: picked.time,
      duration_min: null,
      remind_offset_min: 0,
      repeat: 'none',
      done: false, skipped: false,
      notes: null, assigned_by: null,
      snoozed_until: null, fired_at: null
    });
  }

  await invoke('save_data', { data });
  await invoke('finish_onboarding');
}

invoke('get_data').then((d) => { data = d; render(); });
