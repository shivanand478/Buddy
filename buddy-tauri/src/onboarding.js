import { installSprite, buddyArt, CHARACTERS } from './characters.js';
import { esc } from './util.js';
import { FOCUS_AREAS } from './ask.js';

const { invoke } = window.__TAURI__.core;

installSprite();

let data = null;
let step = 0;

const picked = { name: '', areas: [], autostart: true };

const el = (id) => document.getElementById(id);

// A reminder mock, so the character choice is shown doing its actual job.
function demoMarkup(char) {
  return `
    <div class="demo-stage">
      <div class="demo-pop" id="demoPop">
        ${buddyArt(char)}
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
  // 01 — Meet Conviea. The product introduces itself before it asks anything.
  () => ({
    center: true,
    html: `
      <div class="hero-buddy">${buddyArt(data.prefs.character)}</div>
      <h2>Meet your new buddy.</h2>
      <p class="sub">I'll remind you when it's time to get things done.<br>
      Tasks, routines, goals — you tell me when. I'll remember.</p>
      <input id="obName" placeholder="What should I call you?" value="${esc(picked.name)}"
             style="width:240px;font-size:16px;padding:12px 14px;text-align:center" autocomplete="off">`,
    next: "Let's get started →",
    onMount() {
      const i = el('obName');
      i.focus();
      i.addEventListener('input', (e) => { picked.name = e.target.value; });
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(step + 1); });
    }
  }),

  // 02 — Pick your buddy. The character is the identity of the product, so it
  // gets a screen of its own and is shown doing the one thing it does.
  () => ({
    html: `
      <h2>Pick your buddy.</h2>
      <p class="sub">You'll see them whenever it's time for a reminder.</p>
      <div class="char-grid" style="width:100%">
        ${CHARACTERS.map((c) => `
          <button class="char-pick ${data.prefs.character === c.id ? 'on' : ''}" data-char="${c.id}">
            ${buddyArt(c.id)}
            <span class="n">${c.name}</span>
            <span class="r">${c.role}</span>
          </button>`).join('')}
      </div>
      <p class="sub" id="charLine" style="font-style:italic;min-height:1.4em;margin-top:-4px"></p>
      ${demoMarkup(data.prefs.character)}`,
    next: 'This one →',
    onMount() {
      const c = CHARACTERS.find((x) => x.id === data.prefs.character);
      if (c) el('charLine').textContent = `"${c.line}"`;
      setTimeout(playDemo, 300);
      el('step').querySelectorAll('[data-char]').forEach((b) =>
        b.addEventListener('click', () => { data.prefs.character = b.dataset.char; render(); }));
    }
  }),

  // 03 — What should Conviea help with? Not a life-setup form: this only decides
  // which starter suggestions show up on the next screen and in the Tasks view.
  () => ({
    html: `
      <h2>What should Conviea help you with?</h2>
      <p class="sub">Pick whatever matters to you. You can change this anytime.</p>
      <div class="focus-grid">
        ${FOCUS_AREAS.map((a) => `
          <button class="focus-card ${picked.areas.includes(a.id) ? 'on' : ''}" data-area="${a.id}">
            <span class="e">${a.emoji}</span>
            <span class="t">${a.name}</span>
          </button>`).join('')}
      </div>`,
    next: 'Continue',
    onMount() {
      el('step').querySelectorAll('[data-area]').forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.area;
          const i = picked.areas.indexOf(id);
          if (i === -1) picked.areas.push(id); else picked.areas.splice(i, 1);
          b.classList.toggle('on', picked.areas.includes(id));
        }));
    }
  }),

  // 04 — ready. Permissions land last, each with the reason attached, so they
  // are asked of someone who has already seen what they buy.
  () => ({
    html: `
      <div class="ready-head">
        <div class="hero-buddy small">${buddyArt(data.prefs.character)}</div>
        <h2>You're ready${picked.name.trim() ? ', ' + esc(picked.name.trim()) : ''}.</h2>
        <p class="sub" id="obRecap"></p>
      </div>
      <div class="perm">
        <div class="perm-row">
          <div>
            <div class="perm-t">Open Conviea when I start my computer</div>
            <div class="perm-d">This is how I'm already there in the morning, without you opening anything.</div>
          </div>
          <button class="switch ${picked.autostart ? 'on' : ''}" id="obAuto"></button>
        </div>
        <div class="perm-row">
          <div>
            <div class="perm-t">Allow notifications</div>
            <div class="perm-d">A backup for when you're full screen and can't see the corner.</div>
          </div>
          <button class="btn" id="obNotif">Allow</button>
        </div>
      </div>`,
    next: 'Start',
    onMount() {
      el('obRecap').textContent =
        'Next: add what you need to do today, and I’ll show up when it’s time.';

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
          data.prefs.native_notifications = granted;
        } catch (e) {
          btn.textContent = 'Skipped';
        }
        btn.disabled = true;
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

  host.className = 'step' + (s.center ? ' center' : '');
  host.innerHTML = s.html;

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
  data.prefs.focus_areas = picked.areas.slice();
  data.prefs.onboarded = true;

  await invoke('save_data', { data });
  try { await invoke('set_autostart', { enabled: picked.autostart }); } catch (e) {}
  data.prefs.autostart = picked.autostart;
  await invoke('save_data', { data });
  await invoke('finish_briefing');   // onboarding *is* today's check-in
  await invoke('finish_onboarding');
}

invoke('get_data').then((d) => {
  data = d;
  data.check_in = data.check_in || { enabled: false, every_minutes: 120, last_fired: null, snoozed_until: null };
  render();
});
