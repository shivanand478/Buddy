import { installSprite, buddySvg, CHARACTERS } from './characters.js';
import { esc, newId, hhmmLabel, parseHHMM } from './util.js';
import { askFlow } from './ask.js';

const { invoke } = window.__TAURI__.core;

installSprite();

let data = null;
let step = 0;
const picked = { name: '', dayStart: '08:00', windDown: '22:30', task: null, autostart: true };

const el = (id) => document.getElementById(id);

// A reminder mock, so the value is visible before anything is asked of the user.
function demoMarkup(char) {
  return `
    <div class="demo-stage">
      <div class="demo-pop" id="demoPop">
        ${buddySvg(char)}
        <div class="demo-bubble">
          <div class="demo-kind">TASK · 4:30 PM</div>
          <div class="demo-msg">Time to finish the homepage.</div>
          <div class="demo-acts"><span class="on">Done</span><span>Snooze</span><span>Skip</span></div>
        </div>
      </div>
    </div>`;
}

function playDemo() {
  const pop = el('demoPop');
  if (!pop) return;
  pop.classList.remove('in');
  void pop.offsetWidth;
  pop.classList.add('in');
  clearTimeout(playDemo._t);
  playDemo._t = setTimeout(() => pop.classList.remove('in'), 4200);
}

const SCREENS = [
  // 1 — who are you? (asked first because every later screen uses it)
  () => ({
    html: `
      <div class="step center">
        ${buddySvg(data.prefs.character)}
        <h2>Hi — I'm Buddy.</h2>
        <p class="sub">I'll remember the things you don't want to forget.<br>What should I call you?</p>
        <input id="obName" placeholder="Your name" value="${esc(picked.name)}"
               style="width:220px;font-size:17px;padding:12px 14px;text-align:center" autocomplete="off">
      </div>`,
    next: 'Continue',
    onMount() {
      const i = el('obName');
      i.focus();
      i.addEventListener('input', (e) => { picked.name = e.target.value; });
    }
  }),

  // 2 — show the product working, before asking for anything
  () => ({
    html: `
      <h2>This is the whole app.</h2>
      <p class="sub">I stay hidden. When something's due I appear in the corner
      for a few seconds, you deal with it, and I'm gone.</p>
      ${demoMarkup(data.prefs.character)}
      <button class="btn" id="replay" style="align-self:flex-start">Show me again</button>`,
    next: 'Makes sense',
    onMount() {
      setTimeout(playDemo, 350);
      el('replay').addEventListener('click', playDemo);
    }
  }),

  // 3 — now the character choice means something: it's who shows up
  () => ({
    html: `
      <h2>So who should show up?</h2>
      <p class="sub">Pick the one you won't mind seeing every day.</p>
      <div class="char-grid" style="width:100%">
        ${CHARACTERS.map((c) => `
          <button class="char-pick ${data.prefs.character === c.id ? 'on' : ''}" data-char="${c.id}">
            ${buddySvg(c.id)}
            <span class="n">${c.name}</span>
            <span class="r">${c.role}</span>
          </button>`).join('')}
      </div>
      <p class="sub" id="charLine" style="font-style:italic;min-height:1.4em"></p>
      ${demoMarkup(data.prefs.character)}`,
    next: 'Continue',
    onMount() {
      const line = el('charLine');
      const c = CHARACTERS.find((x) => x.id === data.prefs.character);
      if (c) line.textContent = `"${c.line}"`;
      setTimeout(playDemo, 300);
      el('step').querySelectorAll('[data-char]').forEach((b) =>
        b.addEventListener('click', () => {
          data.prefs.character = b.dataset.char;
          render();
        }));
    }
  }),

  // 4 — one question that configures quiet hours AND the morning check-in
  () => ({
    html: `
      <h2>When is your day?</h2>
      <p class="sub">I'll check in with you when it starts, and go quiet after it ends.
      Nothing will ever wake you up.</p>
      <div style="display:flex;gap:22px;margin-top:6px">
        <label class="field" style="gap:6px">
          <span class="label">My day starts</span>
          <input type="time" id="obStart" value="${picked.dayStart}" style="font-size:17px;padding:11px 13px">
        </label>
        <label class="field" style="gap:6px">
          <span class="label">I wind down</span>
          <input type="time" id="obEnd" value="${picked.windDown}" style="font-size:17px;padding:11px 13px">
        </label>
      </div>
      <p class="sub" id="quietEcho" style="font-family:var(--font-mono);font-size:12px"></p>`,
    next: 'Continue',
    onMount() {
      const echo = () => {
        el('quietEcho').textContent =
          `Quiet from ${hhmmLabel(picked.windDown)} to ${hhmmLabel(picked.dayStart)}`;
      };
      el('obStart').addEventListener('change', (e) => { picked.dayStart = e.target.value; echo(); });
      el('obEnd').addEventListener('change', (e) => { picked.windDown = e.target.value; echo(); });
      echo();
    }
  }),

  // 5 — the first task, using the same flow the app uses forever after
  () => ({
    html: `
      <h2>What's one thing you need to do today?</h2>
      <p class="sub">Just one. Buddy works best when today is small.</p>
      <div id="obAsk"></div>`,
    hideFoot: true,
    onMount() {
      askFlow(el('obAsk'), {
        onCreate: (task) => { picked.task = task; go(step + 1); },
        onCancel: () => go(step + 1)
      });
    }
  }),

  // 6 — permissions, primed with the reason, last so they're already invested
  () => ({
    html: `
      <h2>Two last things.</h2>
      <div class="perm">
        <div class="perm-row">
          <div>
            <div class="perm-t">Open Buddy when I start my computer</div>
            <div class="perm-d">This is how I'm there in the morning without you opening anything.</div>
          </div>
          <button class="switch ${picked.autostart ? 'on' : ''}" id="obAuto"></button>
        </div>
        <div class="perm-row">
          <div>
            <div class="perm-t">Allow notifications</div>
            <div class="perm-d">A backup for when you're in full screen and can't see the corner.</div>
          </div>
          <button class="btn" id="obNotif">Allow</button>
        </div>
      </div>`,
    next: 'Start',
    onMount() {
      el('obAuto').addEventListener('click', () => {
        picked.autostart = !picked.autostart;
        el('obAuto').classList.toggle('on', picked.autostart);
      });
      el('obNotif').addEventListener('click', async () => {
        const btn = el('obNotif');
        try {
          const n = window.__TAURI__.notification;
          let granted = await n.isPermissionGranted();
          if (!granted) granted = (await n.requestPermission()) === 'granted';
          btn.textContent = granted ? 'Allowed ✓' : 'Not allowed';
          btn.disabled = true;
        } catch (e) {
          btn.textContent = 'Skipped';
          btn.disabled = true;
        }
      });
    }
  })
];

function go(n) {
  step = Math.max(0, Math.min(SCREENS.length - 1, n));
  render();
}

function render() {
  const s = SCREENS[step]();
  const host = el('step');

  host.className = 'step' + (s.html.includes('class="step center"') ? ' center' : '');
  host.innerHTML = s.html.includes('<div class="step')
    ? s.html.replace(/^\s*<div class="step[^"]*">|<\/div>\s*$/g, '')
    : s.html;

  el('dots').innerHTML = SCREENS.map((_, i) => `<span class="dot ${i === step ? 'on' : ''}"></span>`).join('');
  el('back').hidden = step === 0;
  el('foot').style.visibility = s.hideFoot ? 'hidden' : 'visible';
  el('next').textContent = s.next || 'Continue';

  if (s.onMount) s.onMount();
}

el('next').addEventListener('click', () => {
  if (step < SCREENS.length - 1) { go(step + 1); return; }
  finish();
});
el('back').addEventListener('click', () => go(step - 1));

async function finish() {
  data.prefs.name = picked.name.trim();
  data.prefs.onboarded = true;
  // The single "when is your day" answer drives both ends of quiet hours.
  data.prefs.quiet_end = parseHHMM(picked.dayStart) ?? 8 * 60;
  data.prefs.quiet_start = parseHHMM(picked.windDown) ?? 23 * 60;

  if (picked.task) data.tasks.push(picked.task);

  await invoke('save_data', { data });
  try { await invoke('set_autostart', { enabled: picked.autostart }); } catch (e) {}
  data.prefs.autostart = picked.autostart;
  await invoke('save_data', { data });
  await invoke('finish_briefing');   // onboarding *is* today's check-in
  await invoke('finish_onboarding');
}

invoke('get_data').then((d) => { data = d; render(); });
