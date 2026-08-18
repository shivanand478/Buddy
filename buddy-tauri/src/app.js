import { installSprite, buddySvg, checkSvg, CHARACTERS } from './characters.js';
import { askFlow, FOCUS_AREAS, suggestionsFor, normalizeAreas } from './ask.js';
import { esc, todayStr, nowMinutes, parseHHMM, label, newId } from './util.js';

const { invoke } = window.__TAURI__.core;

installSprite();

let data = null;
let view = 'today';

const main = document.getElementById('main');

// ---------------------------------------------------------------- time utils




/** "in 18 minutes" reads well; "in 515 minutes" does not. */
function awayLabel(mins) {
  if (mins <= 0) return 'right about now';
  if (mins < 90) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h} hours`;
}

const DAYS = [['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',7]];
const weekdayNow = () => (new Date().getDay() + 6) % 7 + 1;

// ---------------------------------------------------------------- persistence

async function load() {
  data = await invoke('get_data');
  data.check_in = data.check_in || { enabled: false, every_minutes: 120, last_fired: null, snoozed_until: null };
  data.prefs.focus_areas = normalizeAreas(data.prefs.focus_areas);
  data.account = data.account || { email: '', verified: false, token: null, local_only: false };
  document.getElementById('sideChar').setAttribute('href', `#c-${data.prefs.character}`);
}

async function save() {
  await invoke('save_data', { data });
  document.getElementById('sideChar').setAttribute('href', `#c-${data.prefs.character}`);
  render();
}

// ---------------------------------------------------------------- today

/** Everything happening today, from every source, in one ordered list. */
function todaysAgenda() {
  const rows = [];

  for (const t of data.tasks) {
    if (t.date !== todayStr()) continue;
    rows.push({
      mins: parseHHMM(t.time),
      title: t.title,
      done: t.done,
      skipped: t.skipped,
      kind: t.assigned_by ? 'team' : 'task',
      note: t.assigned_by ? `from ${t.assigned_by}` : (t.duration_min ? `${t.duration_min} min` : ''),
      id: t.id
    });
  }

  for (const r of data.routine) {
    if (!r.enabled) continue;
    if (r.days.length && !r.days.includes(weekdayNow())) continue;
    rows.push({
      mins: parseHHMM(r.time),
      title: `${r.emoji} ${r.title}`,
      done: r.completed_on === todayStr(),
      skipped: r.skipped_on === todayStr(),
      kind: 'routine',
      note: '',
      id: r.id
    });
  }

  for (const g of data.goals) {
    if (!g.active || !g.today_action || !g.today_time) continue;
    rows.push({
      mins: parseHHMM(g.today_time),
      title: `${g.emoji || '🚀'} ${g.today_action}`,
      done: false,
      skipped: false,
      kind: 'goal',
      note: `toward ${g.title}`,
      id: g.id
    });
  }

  return rows.sort((a, b) => (a.mins ?? 0) - (b.mins ?? 0));
}

function viewToday() {
  const agenda = todaysAgenda();
  const open = agenda.filter((r) => !r.done && !r.skipped);
  const next = open.find((r) => r.mins != null && r.mins >= nowMinutes()) || null;
  const tasksToday = data.tasks.filter((t) => t.date === todayStr());
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Still up?';
  const name = data.prefs.name ? ` ${data.prefs.name}` : '';

  let html = `
    <div class="view-head">
      <h1>${greet}${esc(name)} 👋</h1>
      <p>${open.length ? `You've got ${open.length} thing${open.length === 1 ? '' : 's'} today.` : 'Nothing left today. Enjoy it.'}</p>
    </div>`;

  // The one thing Home asks of you. Everything else on this screen is a report.
  html += `
    <button class="cta" id="ctaTodo">
      <span class="cta-mark">${buddySvg(data.prefs.character)}</span>
      <span class="cta-text">
        <span class="cta-t">Create today's to-do</span>
        <span class="cta-d">${tasksToday.length
          ? 'Add another thing, or change what’s already there.'
          : 'Tell me what needs doing and when — I’ll handle the rest.'}</span>
      </span>
      <span class="cta-go">→</span>
    </button>`;

  if (next) {
    html += `
      <div class="next-up">
        ${buddySvg(data.prefs.character)}
        <div>
          <div class="k">Next</div>
          <div class="v">${esc(next.title)}</div>
          <div class="s">${awayLabel(next.mins - nowMinutes())} · ${label(next.mins)}</div>
        </div>
      </div>`;
  }

  if (!agenda.length) {
    html += `<div class="empty">${buddySvg(data.prefs.character)}<div>Nothing planned yet.<br>Add one thing you need to do today.</div></div>`;
  } else {
    html += `<div class="card">${agenda.map(rowHtml).join('')}</div>`;
  }

  // The gentle nudge from the spec — guide, never restrict.
  if (tasksToday.filter((t) => !t.done && !t.skipped).length > 3) {
    html += `<div class="hint" style="margin-top:12px">That's quite a day. Want to move something to tomorrow?</div>`;
  }

  main.innerHTML = html;
  document.getElementById('ctaTodo').addEventListener('click', () => setView('tasks'));
  wireRows();
}

function rowHtml(r) {
  const pill = r.kind === 'team' ? '<span class="pill pill-coral">Team</span>'
    : r.kind === 'routine' ? '<span class="pill">Routine</span>'
    : r.kind === 'goal' ? '<span class="pill pill-sage">Goal</span>' : '';
  return `
    <div class="row">
      <button class="tick ${r.done ? 'on' : ''}" data-toggle="${r.kind}" data-id="${r.id}">${checkSvg()}</button>
      <span class="when">${label(r.mins)}</span>
      <span class="what ${r.done || r.skipped ? 'done' : ''}">${esc(r.title)}</span>
      <span class="grow"></span>
      ${r.note ? `<span class="pill">${esc(r.note)}</span>` : ''}
      ${pill}
    </div>`;
}

function wireRows() {
  main.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const { toggle, id } = b.dataset;
      if (toggle === 'routine') {
        const r = data.routine.find((x) => x.id === id);
        if (r) r.completed_on = r.completed_on === todayStr() ? null : todayStr();
      } else if (toggle === 'task' || toggle === 'team') {
        const t = data.tasks.find((x) => x.id === id);
        if (t) t.done = !t.done;
      }
      save();
    });
  });
}



/**
 * When carried-over work should land: an hour from now, rounded to the next
 * half hour — but never inside quiet hours, where it could never fire.
 */
function carryTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  let mins = d.getHours() * 60 + d.getMinutes();

  const { quiet_start: qs, quiet_end: qe } = data.prefs;
  const quiet = qs === qe ? false
    : qs < qe ? (mins >= qs && mins < qe)
              : (mins >= qs || mins < qe);
  if (quiet) mins = qe;                       // wait until the day starts

  return String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' +
         String(mins % 60).padStart(2, '0');
}

// ---------------------------------------------------------------- morning check-in

/** Yesterday's leftovers, fetched from Rust so "before today" is one source of truth. */
async function staleTasks() {
  try { return await invoke('unfinished_before_today'); } catch (e) { return []; }
}

async function viewBriefing() {
  const stale = await staleTasks();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = data.prefs.name ? ', ' + data.prefs.name : '';

  main.innerHTML = `
    <div class="brief">
      <div class="brief-hi">
        ${buddySvg(data.prefs.character)}
        <div>
          <h1>${greet}${esc(name)} 👋</h1>
          <p>${stale.length ? "Before we start — a few things didn't get done." : "Let's set up your day."}</p>
        </div>
      </div>

      ${stale.length ? `
        <div class="brief-step">
          <span class="label">Still open from before</span>
          <div id="carryList">
            ${stale.map(t => `
              <div class="carry" data-carry="${t.id}">
                <span class="t">${esc(t.title)}</span>
                <span class="ago">${esc(t.date)}</span>
                <button class="btn" data-today="${t.id}">Do it today</button>
                <button class="btn btn-quiet" data-drop="${t.id}">Drop</button>
              </div>`).join('')}
          </div>
        </div>` : ''}

      <div class="brief-step">
        <span class="label">What do you need to do today?</span>
        <div id="briefAsk"></div>
        <div id="briefAdded"></div>
      </div>

      <div class="brief-step" style="display:flex;gap:10px;align-items:center">
        <button class="btn btn-primary" id="briefStart">Start my day</button>
        <span class="label" style="text-transform:none;letter-spacing:0">I'll stay out of your way until something's due.</span>
      </div>
    </div>`;

  mountBriefAsk();

  main.querySelectorAll('[data-today]').forEach(b => b.addEventListener('click', async () => {
    const hhmm = carryTime();
    await invoke('carry_over', { id: b.dataset.today, time: hhmm });
    settle(b, `moved to ${label(parseHHMM(hhmm))}`);
  }));

  main.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', async () => {
    await invoke('drop_task', { id: b.dataset.drop });
    settle(b, 'dropped');
  }));

  document.getElementById('briefStart').addEventListener('click', async () => {
    await invoke('finish_briefing');
    await load();
    setView('today');
  });
}

function settle(btn, note) {
  const row = btn.closest('.carry');
  row.classList.add('settled');
  row.querySelectorAll('button').forEach(x => x.remove());
  const tag = document.createElement('span');
  tag.className = 'ago';
  tag.textContent = note;
  row.appendChild(tag);
}

/// Starter chips from `prefs.focus_areas`, only while there's little to look at.
function starters() {
  if (data.tasks.filter((t) => t.open !== false && !t.done).length >= 3) return [];
  return suggestionsFor(data.prefs.focus_areas || []);
}

function mountBriefAsk() {
  const host = document.getElementById('briefAsk');
  if (!host) return;
  askFlow(host, {
    suggestions: starters(),
    onCreate: async (task) => {
      data.tasks.push(task);
      await invoke('save_data', { data });
      const added = document.getElementById('briefAdded');
      const line = document.createElement('div');
      line.className = 'carry';
      line.innerHTML = `<span class="t">${esc(task.title)}</span><span class="ago">${esc(label(parseHHMM(task.time)))}</span>`;
      added.appendChild(line);
      mountBriefAsk();            // ready for the next one
    },
    onCancel: () => { host.innerHTML = ''; }
  });
}

// ---------------------------------------------------------------- tasks

function viewTasks() {
  const upcoming = [...data.tasks].sort((a, b) =>
    (a.date + a.time).localeCompare(b.date + b.time));

  main.innerHTML = `
    <div class="view-head">
      <h1>Tasks</h1>
      <p>Every task gets a time. That's what makes the reminder worth anything.</p>
    </div>
    <div id="taskAsk" style="margin-bottom:14px"></div>
    <div class="card">
      ${upcoming.length ? upcoming.map(taskRow).join('') : '<div class="empty">No tasks yet.</div>'}
    </div>`;

  mountTaskAsk();

  main.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      data.tasks = data.tasks.filter((t) => t.id !== b.dataset.del);
      save();
    });
  });
  main.querySelectorAll('[data-tdone]').forEach((b) => {
    b.addEventListener('click', () => {
      const t = data.tasks.find((x) => x.id === b.dataset.tdone);
      if (t) t.done = !t.done;
      save();
    });
  });
}

function mountTaskAsk() {
  const host = document.getElementById('taskAsk');
  if (!host) return;
  askFlow(host, {
    suggestions: starters(),
    onCreate: async (task) => {
      data.tasks.push(task);
      await invoke('save_data', { data });
      await load();
      render();
    },
    onCancel: () => mountTaskAsk()
  });
}

function taskRow(t) {
  const when = t.date === todayStr() ? 'Today' : t.date;
  return `
    <div class="row">
      <button class="tick ${t.done ? 'on' : ''}" data-tdone="${t.id}">${checkSvg()}</button>
      <span class="when">${esc(when)}</span>
      <span class="what ${t.done || t.skipped ? 'done' : ''}">${esc(t.title)}</span>
      <span class="grow"></span>
      <span class="pill">${label(parseHHMM(t.time))}</span>
      ${t.repeat !== 'none' ? `<span class="pill pill-sage">${esc(t.repeat)}</span>` : ''}
      <button class="btn btn-quiet" data-del="${t.id}" title="Delete">✕</button>
    </div>`;
}

function addTask() {
  const title = document.getElementById('tTitle').value.trim();
  if (!title) return;
  const time = document.getElementById('tTime').value || '09:00';
  const dur = document.getElementById('tDur').value;

  data.tasks.push({
    id: newId(),
    title,
    date: document.getElementById('tDate').value || todayStr(),
    time,
    duration_min: dur ? Number(dur) : null,
    remind_offset_min: Number(document.getElementById('tOffset').value),
    repeat: document.getElementById('tRepeat').value,
    done: false,
    skipped: false,
    notes: null,
    assigned_by: null,
    snoozed_until: null,
    fired_at: null
  });

  document.getElementById('tTitle').value = '';
  const msg = `Got it. I'll remind you at ${label(parseHHMM(time))} 👋`;
  save().then(() => {
    const c = document.getElementById('tConfirm');
    if (c) { c.textContent = msg; setTimeout(() => { if (c) c.textContent = ''; }, 3500); }
  });
}

// ---------------------------------------------------------------- routine

function viewRoutine() {
  const items = [...data.routine].sort((a, b) => (parseHHMM(a.time) ?? 0) - (parseHHMM(b.time) ?? 0));

  main.innerHTML = `
    <div class="view-head">
      <h1>Routine</h1>
      <p>Things that happen again and again. You choose the time, Buddy handles the rest.</p>
    </div>

    <div class="card">
      <div class="form-grid">
        <div class="field" style="grid-column:1/-1"><span class="label">What happens?</span>
          <input id="rTitle" placeholder="Gym" autocomplete="off"></div>
        <div class="field"><span class="label">Emoji</span><input id="rEmoji" value="🏋️" maxlength="4"></div>
        <div class="field"><span class="label">Time</span><input id="rTime" type="time" value="17:30"></div>
      </div>
      <div style="margin-top:10px">
        <span class="label">Days <span style="text-transform:none;letter-spacing:0">(none selected = every day)</span></span>
        <div class="chips" id="rDays" style="margin-top:6px">
          ${DAYS.map(([n, v]) => `<button class="chip" data-day="${v}">${n}</button>`).join('')}
        </div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="rAdd">Add to routine</button></div>
    </div>

    <div class="card">
      ${items.length ? items.map(routineRow).join('') : '<div class="empty">Nothing in your routine yet.</div>'}
    </div>`;

  main.querySelectorAll('#rDays .chip').forEach((c) =>
    c.addEventListener('click', () => c.classList.toggle('on')));

  document.getElementById('rAdd').addEventListener('click', () => {
    const title = document.getElementById('rTitle').value.trim();
    if (!title) return;
    data.routine.push({
      id: newId(),
      title,
      emoji: document.getElementById('rEmoji').value || '•',
      time: document.getElementById('rTime').value || '09:00',
      days: [...main.querySelectorAll('#rDays .chip.on')].map((c) => Number(c.dataset.day)),
      enabled: true,
      completed_on: null,
      skipped_on: null,
      snoozed_until: null,
      fired_at: null
    });
    save();
  });

  main.querySelectorAll('[data-rdel]').forEach((b) => b.addEventListener('click', () => {
    data.routine = data.routine.filter((r) => r.id !== b.dataset.rdel);
    save();
  }));
  main.querySelectorAll('[data-rtoggle]').forEach((b) => b.addEventListener('click', () => {
    const r = data.routine.find((x) => x.id === b.dataset.rtoggle);
    if (r) r.enabled = !r.enabled;
    save();
  }));
}

function routineRow(r) {
  const days = r.days.length
    ? DAYS.filter(([, v]) => r.days.includes(v)).map(([n]) => n).join(' · ')
    : 'Every day';
  return `
    <div class="row">
      <span class="when">${label(parseHHMM(r.time))}</span>
      <span class="what" style="${r.enabled ? '' : 'opacity:.5'}">${esc(r.emoji)} ${esc(r.title)}</span>
      <span class="grow"></span>
      <span class="pill">${esc(days)}</span>
      <button class="btn btn-quiet" data-rtoggle="${r.id}">${r.enabled ? 'On' : 'Off'}</button>
      <button class="btn btn-quiet" data-rdel="${r.id}">✕</button>
    </div>`;
}

// ---------------------------------------------------------------- goals

function viewGoals() {
  main.innerHTML = `
    <div class="view-head">
      <h1>Goals</h1>
      <p>Direction, not another task list. Keep it to a few.</p>
    </div>

    <div class="card">
      <div class="form-grid">
        <div class="field"><span class="label">Emoji</span><input id="gEmoji" value="🚀" maxlength="4"></div>
        <div class="field" style="grid-column:2/-1"><span class="label">Goal</span>
          <input id="gTitle" placeholder="Build a SaaS" autocomplete="off"></div>
        <div class="field" style="grid-column:1/-1"><span class="label">Weekly target</span>
          <input id="gWeekly" placeholder="Work on it 5 hours"></div>
        <div class="field" style="grid-column:1/3"><span class="label">Today's action</span>
          <input id="gToday" placeholder="30 minutes on the landing page"></div>
        <div class="field"><span class="label">At</span><input id="gTime" type="time" value="20:00"></div>
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="gAdd">Add goal</button></div>
    </div>

    ${data.goals.length ? data.goals.map(goalCard).join('') : '<div class="card"><div class="empty">No goals yet.</div></div>'}`;

  document.getElementById('gAdd').addEventListener('click', () => {
    const title = document.getElementById('gTitle').value.trim();
    if (!title) return;
    data.goals.push({
      id: newId(),
      title,
      emoji: document.getElementById('gEmoji').value || '🚀',
      weekly_target: document.getElementById('gWeekly').value.trim(),
      today_action: document.getElementById('gToday').value.trim(),
      today_time: document.getElementById('gTime').value || null,
      fired_at: null,
      active: true
    });
    save();
  });

  main.querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', () => {
    data.goals = data.goals.filter((g) => g.id !== b.dataset.gdel);
    save();
  }));
}

function goalCard(g) {
  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px">
        <h3 style="font-size:17px">${esc(g.emoji)} ${esc(g.title)}</h3>
        <span class="grow" style="flex:1"></span>
        <button class="btn btn-quiet" data-gdel="${g.id}">✕</button>
      </div>
      ${g.weekly_target ? `<div class="row"><span class="when">Weekly</span><span class="what">${esc(g.weekly_target)}</span></div>` : ''}
      ${g.today_action ? `<div class="row"><span class="when">${label(parseHHMM(g.today_time))}</span><span class="what">${esc(g.today_action)}</span></div>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- team

function viewTeam() {
  main.innerHTML = `
    <div class="view-head">
      <h1>Team</h1>
      <p>Assign a task with a time. The other person's Buddy does the reminding.</p>
    </div>

    <div class="hint">
      <strong>Not connected in this build.</strong><br>
      Teams need an account and a sync server — assigning work to someone else means
      their copy of Buddy has to receive it. The local side is ready: a task carrying
      an <em>assigned by</em> name already shows and reminds as a team task, which is
      what you can try below.
    </div>

    <div class="card" style="margin-top:12px">
      <div class="form-grid">
        <div class="field" style="grid-column:1/3"><span class="label">What needs to be done?</span>
          <input id="mTitle" placeholder="Finish mobile homepage"></div>
        <div class="field"><span class="label">Assigned by</span><input id="mBy" placeholder="Shiv"></div>
        <div class="field"><span class="label">Time</span><input id="mTime" type="time" value="16:30"></div>
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-primary" id="mAdd">Add as a team task</button>
      </div>
    </div>

    <div class="card">
      ${data.tasks.filter((t) => t.assigned_by).map(taskRow).join('') || '<div class="empty">No team tasks.</div>'}
    </div>`;

  document.getElementById('mAdd').addEventListener('click', () => {
    const title = document.getElementById('mTitle').value.trim();
    const by = document.getElementById('mBy').value.trim() || 'a teammate';
    if (!title) return;
    data.tasks.push({
      id: newId(),
      title,
      date: todayStr(),
      time: document.getElementById('mTime').value || '16:30',
      duration_min: null,
      remind_offset_min: 0,
      repeat: 'none',
      done: false,
      skipped: false,
      notes: null,
      assigned_by: by,
      snoozed_until: null,
      fired_at: null
    });
    save();
  });

  main.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    data.tasks = data.tasks.filter((t) => t.id !== b.dataset.del);
    save();
  }));
  main.querySelectorAll('[data-tdone]').forEach((b) => b.addEventListener('click', () => {
    const t = data.tasks.find((x) => x.id === b.dataset.tdone);
    if (t) t.done = !t.done;
    save();
  }));
}

// ---------------------------------------------------------------- settings

function viewSettings() {
  const p = data.prefs;
  const acct = data.account || { email: '', verified: false, local_only: false };
  main.innerHTML = `
    <div class="view-head"><h1>Settings</h1></div>

    <div class="card">
      <span class="label">Your buddy</span>
      <div class="char-grid" style="margin-top:10px">
        ${CHARACTERS.map((c) => `
          <button class="char-pick ${p.character === c.id ? 'on' : ''}" data-char="${c.id}">
            ${buddySvg(c.id)}
            <span class="n">${c.name}</span>
            <span class="r">${c.role}</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="card">
      <span class="label">Account</span>
      <div class="toggle-row">
        <div>
          <div class="t">${esc(acct.email || 'Not signed in')}</div>
          <div class="d">${acct.local_only
            ? 'Stored on this computer only — not verified, no account server yet.'
            : acct.verified ? 'Email verified.' : 'Not verified.'}</div>
        </div>
        <button class="btn" id="sSignOut">Sign out</button>
      </div>
    </div>

    <div class="card">
      <span class="label">Your name</span>
      <input id="sName" value="${esc(p.name)}" placeholder="Shiv" style="margin-top:8px;width:220px">
      <div class="d" style="font-size:12.5px;color:var(--text-dim);margin-top:6px">
        Buddy uses this to say hello.
      </div>
    </div>

    <div class="card">
      <span class="label">Water reminder</span>
      <div class="toggle-row">
        <div><div class="t">Remind me to drink water</div>
          <div class="d">Optional. Off by default.</div></div>
        <button class="switch ${data.water.enabled ? 'on' : ''}" id="sWater"></button>
      </div>
      <div class="toggle-row">
        <div class="t">How often</div>
        <select id="sWaterEvery" style="width:130px">
          ${[30, 45, 60, 90].map((m) => `<option value="${m}" ${data.water.every_minutes === m ? 'selected' : ''}>Every ${m} min</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card">
      <span class="label">Quick check-in</span>
      <div class="toggle-row">
        <div><div class="t">Pop up now and then with what's next</div>
          <div class="d">Skipped whenever a real reminder is already due.</div></div>
        <button class="switch ${data.check_in.enabled ? 'on' : ''}" id="sCheckin"></button>
      </div>
      <div class="toggle-row">
        <div class="t">How often</div>
        <select id="sCheckinEvery" style="width:130px">
          ${[60, 120, 180, 240].map((m) => `<option value="${m}" ${data.check_in.every_minutes === m ? 'selected' : ''}>Every ${m / 60} h</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card">
      <span class="label">What Buddy helps with</span>
      <div class="d" style="font-size:12.5px;color:var(--text-dim);margin:6px 0 10px">
        Only decides which suggestions you're offered when adding something.
      </div>
      <div class="chips">
        ${FOCUS_AREAS.map((a) => `<button class="chip ${(p.focus_areas || []).includes(a.id) ? 'on' : ''}" data-area="${a.id}">${a.emoji} ${a.name}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <span class="label">Quiet hours</span>
      <div class="toggle-row">
        <div><div class="t">Don't interrupt between</div>
          <div class="d">Buddy stays hidden, whatever is due.</div></div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="sQs" type="time" value="${hhmm(p.quiet_start)}" style="width:110px">
          <span class="d">and</span>
          <input id="sQe" type="time" value="${hhmm(p.quiet_end)}" style="width:110px">
        </div>
      </div>
      <div class="toggle-row">
        <div><div class="t">Stays on screen for</div>
          <div class="d">Then it disappears on its own.</div></div>
        <select id="sDismiss" style="width:110px">
          ${[10, 12, 15].map((s) => `<option value="${s}" ${p.dismiss_seconds === s ? 'selected' : ''}>${s} seconds</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card">
      <span class="label">System</span>
      <div class="toggle-row">
        <div><div class="t">Start Buddy when I turn on my computer</div>
          <div class="d">Opens quietly with no window.</div></div>
        <button class="switch ${p.autostart ? 'on' : ''}" id="sAuto"></button>
      </div>
      <div class="toggle-row">
        <div><div class="t">Also send a system notification</div>
          <div class="d">So reminders still land when you're full-screen.</div></div>
        <button class="switch ${p.native_notifications ? 'on' : ''}" id="sNotif"></button>
      </div>
      <div class="toggle-row">
        <div><div class="t">Try a reminder</div>
          <div class="d">Shows the popup right now.</div></div>
        <button class="btn" id="sTest">Test reminder</button>
      </div>
    </div>`;

  main.querySelectorAll('[data-char]').forEach((b) => b.addEventListener('click', () => {
    data.prefs.character = b.dataset.char;
    save();
  }));

  document.getElementById('sSignOut').addEventListener('click', () => invoke('sign_out'));

  document.getElementById('sName').addEventListener('change', (e) => {
    data.prefs.name = e.target.value.trim();
    save();
  });
  document.getElementById('sWater').addEventListener('click', () => {
    data.water.enabled = !data.water.enabled;
    save();
  });
  document.getElementById('sWaterEvery').addEventListener('change', (e) => {
    data.water.every_minutes = Number(e.target.value);
    save();
  });
  document.getElementById('sCheckin').addEventListener('click', () => {
    data.check_in.enabled = !data.check_in.enabled;
    data.check_in.last_fired = null;   // restart the clock, don't fire at once
    save();
  });
  document.getElementById('sCheckinEvery').addEventListener('change', (e) => {
    data.check_in.every_minutes = Number(e.target.value);
    save();
  });
  main.querySelectorAll('[data-area]').forEach((b) => b.addEventListener('click', () => {
    const areas = data.prefs.focus_areas || (data.prefs.focus_areas = []);
    const i = areas.indexOf(b.dataset.area);
    if (i === -1) areas.push(b.dataset.area); else areas.splice(i, 1);
    save();
  }));
  document.getElementById('sQs').addEventListener('change', (e) => {
    data.prefs.quiet_start = parseHHMM(e.target.value) ?? 1380;
    save();
  });
  document.getElementById('sQe').addEventListener('change', (e) => {
    data.prefs.quiet_end = parseHHMM(e.target.value) ?? 480;
    save();
  });
  document.getElementById('sDismiss').addEventListener('change', (e) => {
    data.prefs.dismiss_seconds = Number(e.target.value);
    save();
  });
  document.getElementById('sAuto').addEventListener('click', async () => {
    data.prefs.autostart = !data.prefs.autostart;
    try { await invoke('set_autostart', { enabled: data.prefs.autostart }); }
    catch (e) { console.error('buddy: autostart failed', e); }
    save();
  });
  document.getElementById('sNotif').addEventListener('click', () => {
    data.prefs.native_notifications = !data.prefs.native_notifications;
    save();
  });
  document.getElementById('sTest').addEventListener('click', () => invoke('test_reminder'));
}

function hhmm(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- shell

const VIEWS = {
  briefing: viewBriefing,
  today: viewToday, tasks: viewTasks, routine: viewRoutine,
  team: viewTeam, goals: viewGoals, settings: viewSettings
};

function setView(name) {
  view = name;
  document.querySelectorAll('.nav-item').forEach(x =>
    x.classList.toggle('on', x.dataset.view === name));
  render();
}

function render() { (VIEWS[view] || viewToday)(); }

document.querySelectorAll('.nav-item').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    view = b.dataset.view;
    render();
  });
});

load()
  .then(async () => {
    // First launch of the day opens on the check-in instead of Today.
    try { if (await invoke('needs_briefing')) view = 'briefing'; } catch (e) {}
    render();
  })
  .catch((e) => {
  main.innerHTML = `<div class="empty">Couldn't load your data.<br><small>${esc(e)}</small></div>`;
});

// Keep "in 18 minutes" honest without a full re-render storm.
setInterval(() => { if (view === 'today') render(); }, 60_000);
