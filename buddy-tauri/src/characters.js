// The four companions. Each is a rendered PNG with a transparent background,
// shipped at two sizes: the full art for hero moments, and an @small copy for
// the places it appears at thumbnail size — a 512px image scaled into a 40px
// box looks soft and costs memory for nothing.

export const CHARACTERS = [
  { id: 'sprout', name: 'Sprout', role: 'The Grower',     line: 'Small steps still count.' },
  { id: 'nimbus', name: 'Nimbus', role: 'The Calm One',   line: 'No rush. We’ll get there.' },
  { id: 'dew',    name: 'Dew',    role: 'The Gentle One', line: 'Ready when you are.' },
  { id: 'sunny',  name: 'Sunny',  role: 'The Cheerer',    line: 'You’ve got this!' }
];

const IDS = CHARACTERS.map((c) => c.id);

/** Falls back to the first character rather than rendering a broken image. */
export function knownCharacter(id) {
  return IDS.includes(id) ? id : IDS[0];
}

/**
 * Warms the browser cache so a character never pops in blank — the reminder
 * window in particular is on screen for only a few seconds.
 */
export function installSprite() {
  if (installSprite._done) return;
  installSprite._done = true;
  IDS.forEach((id) => {
    const a = new Image(); a.src = `img/${id}.png`;
    const b = new Image(); b.src = `img/${id}@small.png`;
  });
}

/**
 * Markup for a character. `small` picks the thumbnail art; the alt text is
 * empty because the character is decoration beside text that already says
 * what is happening.
 */
export function buddyArt(id, cls = '', small = false) {
  const file = `${knownCharacter(id)}${small ? '@small' : ''}.png`;
  return `<img class="buddy-art ${cls}" src="img/${file}" alt="" draggable="false">`;
}

export function checkSvg() {
  return `<svg class="tick-mark" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" stroke-width="2.2"
          fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
