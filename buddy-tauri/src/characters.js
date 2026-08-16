// The five buddies, as one SVG sprite shared by every window.

export const CHARACTERS = [
  { id: 'nub',  name: 'Nub',  role: 'The Motivator', line: "You've got this." },
  { id: 'miso', name: 'Miso', role: 'The Chill One', line: 'No rush.' },
  { id: 'bolt', name: 'Bolt', role: 'The Strict One', line: 'You said 4:30.' },
  { id: 'zib',  name: 'Zib',  role: 'The Chaos One', line: 'HEY. Remember that thing?' },
  { id: 'pip',  name: 'Pip',  role: 'The Steady One', line: 'Right on time.' }
];

const SPRITE = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <style>
    .eyes { transform-box: fill-box; transform-origin: center; animation: blinkEye 5.2s infinite; }
    @keyframes blinkEye { 0%,92%,100% { transform: scaleY(1); } 95% { transform: scaleY(.12); } }
    @media (prefers-reduced-motion: reduce) { .eyes { animation: none; } }
  </style>

  <symbol id="c-pip" viewBox="0 0 100 110">
    <ellipse cx="50" cy="103" rx="26" ry="5" fill="rgba(0,0,0,.14)"/>
    <rect x="30" y="62" width="40" height="38" rx="15" fill="#E0654B"/>
    <circle cx="50" cy="42" r="30" fill="#F6D2B4"/>
    <path d="M20 40c2-20 16-30 30-30s28 10 30 28c-8-6-14-12-22-14-6 6-24 10-38 16z" fill="#3A2A26"/>
    <g class="eyes"><circle cx="40" cy="44" r="4" fill="#2A1F1C"/><circle cx="61" cy="44" r="4" fill="#2A1F1C"/></g>
    <circle cx="32" cy="53" r="5" fill="#EFA089" opacity=".55"/>
    <circle cx="69" cy="53" r="5" fill="#EFA089" opacity=".55"/>
    <path d="M43 56q7 6 14 0" stroke="#2A1F1C" stroke-width="3" fill="none" stroke-linecap="round"/>
  </symbol>

  <symbol id="c-bolt" viewBox="0 0 100 110">
    <ellipse cx="50" cy="103" rx="26" ry="5" fill="rgba(0,0,0,.14)"/>
    <rect x="33" y="66" width="34" height="34" rx="10" fill="#8FA6AE"/>
    <rect x="42" y="72" width="16" height="10" rx="3" fill="#EFB43B"/>
    <path d="M50 14v10" stroke="#8FA6AE" stroke-width="4" stroke-linecap="round"/>
    <circle cx="50" cy="11" r="5" fill="#EFB43B"/>
    <rect x="20" y="24" width="60" height="46" rx="16" fill="#C3D2D6"/>
    <rect x="27" y="33" width="46" height="26" rx="11" fill="#1B3D48"/>
    <g class="eyes"><rect x="35" y="41" width="10" height="10" rx="4" fill="#6FE0C4"/><rect x="55" y="41" width="10" height="10" rx="4" fill="#6FE0C4"/></g>
  </symbol>

  <symbol id="c-miso" viewBox="0 0 100 110">
    <ellipse cx="50" cy="103" rx="26" ry="5" fill="rgba(0,0,0,.14)"/>
    <path d="M50 66c18 0 27 12 27 24 0 6-4 10-9 10H32c-5 0-9-4-9-10 0-12 9-24 27-24z" fill="#F0B48A"/>
    <path d="M25 30l3-19 17 12z" fill="#F0B48A"/><path d="M75 30l-3-19-17 12z" fill="#F0B48A"/>
    <path d="M29 26l2-10 9 7z" fill="#E08C7C"/><path d="M71 26l-2-10-9 7z" fill="#E08C7C"/>
    <ellipse cx="50" cy="44" rx="30" ry="26" fill="#F5C39F"/>
    <g class="eyes"><ellipse cx="39" cy="42" rx="4.5" ry="6" fill="#2E2320"/><ellipse cx="61" cy="42" rx="4.5" ry="6" fill="#2E2320"/></g>
    <path d="M46 53h8l-4 4z" fill="#E08C7C"/>
    <path d="M50 57q-5 5-9 1M50 57q5 5 9 1" stroke="#B5745F" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M16 44h12M16 51h12M84 44H72M84 51H72" stroke="#DCC0AC" stroke-width="1.6" stroke-linecap="round"/>
  </symbol>

  <symbol id="c-zib" viewBox="0 0 100 110">
    <ellipse cx="50" cy="103" rx="24" ry="5" fill="rgba(0,0,0,.14)"/>
    <path d="M50 70c13 0 21 9 21 20 0 6-4 10-10 10H39c-6 0-10-4-10-10 0-11 8-20 21-20z" fill="#5F9C85"/>
    <path d="M34 20l6 12M66 20l-6 12" stroke="#5F9C85" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="33" cy="17" r="4.5" fill="#EFB43B"/><circle cx="67" cy="17" r="4.5" fill="#EFB43B"/>
    <ellipse cx="50" cy="46" rx="29" ry="27" fill="#7FBCA3"/>
    <g class="eyes">
      <ellipse cx="38" cy="45" rx="7" ry="10" fill="#12303A" transform="rotate(-12 38 45)"/>
      <ellipse cx="62" cy="45" rx="7" ry="10" fill="#12303A" transform="rotate(12 62 45)"/>
    </g>
    <circle cx="36" cy="41" r="2.4" fill="#fff"/><circle cx="60" cy="41" r="2.4" fill="#fff"/>
    <path d="M44 61q6 4 12 0" stroke="#3A6B5C" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  </symbol>

  <symbol id="c-nub" viewBox="0 0 100 110">
    <ellipse cx="50" cy="103" rx="27" ry="5" fill="rgba(0,0,0,.14)"/>
    <path d="M50 16c19 0 33 15 33 38 0 26-14 46-33 46S17 80 17 54c0-23 14-38 33-38z" fill="#EFB43B"/>
    <path d="M50 4l9 14H41z" fill="#E0654B"/>
    <g class="eyes">
      <circle cx="38" cy="50" r="8" fill="#fff"/><circle cx="62" cy="50" r="8" fill="#fff"/>
      <circle cx="39" cy="51" r="4" fill="#2A1F1C"/><circle cx="63" cy="51" r="4" fill="#2A1F1C"/>
    </g>
    <path d="M42 68q8 8 16 0" stroke="#8A5F16" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="27" cy="63" r="5" fill="#E0654B" opacity=".45"/>
    <circle cx="73" cy="63" r="5" fill="#E0654B" opacity=".45"/>
    <path d="M34 100l-5 6M66 100l5 6" stroke="#D89F26" stroke-width="4" stroke-linecap="round"/>
  </symbol>

  <symbol id="i-check" viewBox="0 0 12 12">
    <path d="M2 6.4l2.6 2.6L10 3.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
</svg>`;

export function installSprite() {
  if (document.getElementById('buddy-sprite')) return;
  const holder = document.createElement('div');
  holder.id = 'buddy-sprite';
  holder.innerHTML = SPRITE;
  document.body.prepend(holder);
}

/** `<svg>` markup referencing a character from the sprite. */
export function buddySvg(id, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 100 110" aria-hidden="true"><use href="#c-${id}"></use></svg>`;
}

export function checkSvg() {
  return `<svg viewBox="0 0 12 12" aria-hidden="true"><use href="#i-check"></use></svg>`;
}
