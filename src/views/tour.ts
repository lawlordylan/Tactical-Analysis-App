// "How it works" tour: a short, skippable walk through preparing and
// presenting a session. Opens by itself on a first visit (no sessions yet and
// not seen before) and from the home page's "How it works" button.
import { h } from '../lib/dom';
import { CREST } from './actions';

const SEEN_KEY = 'tourSeen';

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage blocked: don't keep showing it
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage blocked */
  }
}

const kbd = (...keys: string[]) => keys.map((k) => h('kbd', null, k));

interface Step {
  part?: 'Prepare a session' | 'Present a session';
  title: string;
  art: string;
  body: HTMLElement[];
}

// Small drawings of each screen, in the app's own colours (classes in styles.css).
const PITCH = '<rect class="t-pitch" x="0" y="0" width="100%" height="100%"/>';
const ART = {
  sessions: `
    <rect class="t-s1 t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-club" x="20" y="20" width="280" height="40" rx="8"/>
    <rect class="t-wh" x="32" y="31" width="86" height="18" rx="5"/>
    <text class="t-ink" x="75" y="43.5" text-anchor="middle">+ New session</text>
    <rect class="t-ring" x="28" y="27" width="94" height="26" rx="8"/>
    <rect class="t-s2" x="20" y="72" width="86" height="88" rx="6"/><rect class="t-pitch" x="26" y="78" width="74" height="42" rx="4"/>
    <rect class="t-txt" x="26" y="128" width="58" height="6" rx="3"/><rect class="t-mu" x="26" y="140" width="38" height="5" rx="2.5"/>
    <rect class="t-s2" x="117" y="72" width="86" height="88" rx="6"/><rect class="t-pitch" x="123" y="78" width="74" height="42" rx="4"/>
    <rect class="t-txt" x="123" y="128" width="50" height="6" rx="3"/><rect class="t-mu" x="123" y="140" width="38" height="5" rx="2.5"/>
    <rect class="t-s2 t-dash" x="214" y="72" width="86" height="88" rx="6"/>`,
  clips: `
    <rect class="t-s1 t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-s2" x="16" y="16" width="70" height="148" rx="6"/>
    <rect class="t-pitch" x="22" y="22" width="58" height="33" rx="3"/>
    <rect class="t-pitch t-sel" x="22" y="62" width="58" height="33" rx="3"/>
    <rect class="t-pitch" x="22" y="102" width="58" height="33" rx="3"/>
    <rect class="t-club" x="22" y="142" width="58" height="16" rx="4"/><text class="t-on" x="51" y="153" text-anchor="middle">+ Add clips</text>
    <rect class="t-pitch" x="96" y="16" width="208" height="92" rx="6"/>
    <path class="t-wh-ln" d="M200 16v92M200 62m-16 0a16 16 0 1 0 32 0a16 16 0 1 0 -32 0"/>
    <rect class="t-bg t-ln" x="96" y="116" width="208" height="16" rx="4"/><text class="t-txt-f" x="102" y="127">Counter-press after losing the ball</text>
    <rect class="t-bg t-ln" x="96" y="138" width="208" height="26" rx="4"/><text class="t-mu-f" x="102" y="149">Comments: nearest three collapse on the ball</text>`,
  shortcuts: `
    <rect class="t-s1 t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-pitch" x="16" y="16" width="180" height="100" rx="6"/>
    <path class="t-wh-ln" d="M106 16v100"/>
    <rect class="t-s3" x="16" y="128" width="180" height="4" rx="2"/><rect class="t-acc" x="16" y="128" width="96" height="4" rx="2"/>
    <circle class="t-acc" cx="112" cy="130" r="5"/>
    <rect class="t-club" x="40" y="140" width="14" height="14" rx="3"/><text class="t-on" x="47" y="150.5" text-anchor="middle">1</text>
    <rect class="t-club" x="105" y="140" width="14" height="14" rx="3"/><text class="t-on" x="112" y="150.5" text-anchor="middle">2</text>
    <rect class="t-club" x="160" y="140" width="14" height="14" rx="3"/><text class="t-on" x="167" y="150.5" text-anchor="middle">3</text>
    <rect class="t-wh" x="206" y="16" width="98" height="20" rx="5"/><text class="t-ink" x="255" y="29.5" text-anchor="middle">Add shortcut</text>
    <rect class="t-bg t-ln" x="206" y="44" width="98" height="22" rx="5"/><rect class="t-club" x="211" y="49" width="12" height="12" rx="3"/><text class="t-txt-f" x="228" y="58">Bad touch</text>
    <rect class="t-wh" x="206" y="72" width="98" height="22" rx="5"/><rect class="t-club" x="211" y="77" width="12" height="12" rx="3"/><text class="t-ink" x="228" y="86">Ball won back</text>
    <rect class="t-bg t-ln" x="206" y="100" width="98" height="22" rx="5"/><rect class="t-club" x="211" y="105" width="12" height="12" rx="3"/><text class="t-txt-f" x="228" y="114">Switch play</text>`,
  draw: `
    <rect class="t-s1 t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-s2" x="16" y="16" width="30" height="148" rx="6"/>
    <rect class="t-wh" x="21" y="22" width="20" height="20" rx="4"/>
    <rect class="t-s3" x="21" y="48" width="20" height="20" rx="4"/><rect class="t-s3" x="21" y="74" width="20" height="20" rx="4"/><rect class="t-s3" x="21" y="100" width="20" height="20" rx="4"/>
    <svg x="54" y="16" width="250" height="148">${PITCH}<path class="t-wh-ln" d="M125 0v148M125 74m-24 0a24 24 0 1 0 48 0a24 24 0 1 0 -48 0"/>
      <ellipse class="t-glow" cx="70" cy="112" rx="20" ry="6"/>
      <g class="t-player"><circle cx="70" cy="80" r="5"/><rect x="65" y="86" width="10" height="24" rx="4"/></g>
      <g class="t-player t-them"><circle cx="160" cy="58" r="5"/><rect x="155" y="64" width="10" height="24" rx="4"/></g>
      <g class="t-player"><circle cx="205" cy="96" r="5"/><rect x="200" y="102" width="10" height="24" rx="4"/></g>
      <path class="t-arrow" d="M80 98 Q130 70 192 100"/><path class="t-arrow-head" d="M182 92 L194 101 L180 104"/>
      <path class="t-run" d="M72 120 Q120 140 196 132"/></svg>`,
  present: `
    <rect class="t-bg t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-s1" x="8" y="8" width="304" height="20" rx="10"/><rect class="t-club" x="8" y="8" width="304" height="2"/>
    <rect class="t-s3" x="18" y="13" width="22" height="10" rx="3"/><rect class="t-txt" x="46" y="15" width="70" height="6" rx="3"/>
    <rect class="t-s1" x="16" y="34" width="18" height="130" rx="5"/>
    <rect class="t-pitch" x="40" y="34" width="184" height="100" rx="5"/>
    <path class="t-wh-ln" d="M132 34v100"/>
    <rect class="t-s1" x="40" y="140" width="184" height="24" rx="5"/>
    <rect class="t-s3" x="48" y="149" width="60" height="4" rx="2"/><circle class="t-txt" cx="146" cy="152" r="8"/><path class="t-bgf" d="M143.5 148v8l6.5-4z"/>
    <rect class="t-s1" x="230" y="34" width="76" height="130" rx="5"/>
    <rect class="t-mu" x="236" y="40" width="40" height="4" rx="2"/>
    <rect class="t-wh" x="236" y="50" width="64" height="14" rx="4"/><rect class="t-club" x="239" y="53" width="8" height="8" rx="2"/>
    <rect class="t-bg t-ln" x="236" y="68" width="64" height="14" rx="4"/><rect class="t-club" x="239" y="71" width="8" height="8" rx="2"/>
    <rect class="t-mu" x="236" y="94" width="40" height="4" rx="2"/>
    <rect class="t-txt" x="236" y="104" width="60" height="4" rx="2"/><rect class="t-txt" x="236" y="112" width="52" height="4" rx="2"/><rect class="t-txt" x="236" y="120" width="56" height="4" rx="2"/>`,
  navigate: `
    <rect class="t-bg t-ln" x="8" y="8" width="304" height="164" rx="10"/>
    <rect class="t-s1" x="8" y="8" width="304" height="30" rx="10"/><rect class="t-club" x="8" y="8" width="304" height="2"/>
    <text class="t-txt-f t-big" x="28" y="29">‹</text>
    <rect class="t-s2 t-acc-ln" x="40" y="14" width="148" height="20" rx="5"/>
    <rect class="t-s3" x="44" y="18" width="26" height="12" rx="3"/><text class="t-mu-f" x="57" y="27" text-anchor="middle">3/16</text>
    <text class="t-txt-f t-b" x="76" y="28">Press from goal kick</text><path class="t-mu-ln" d="M176 22l4 4 4-4"/>
    <text class="t-txt-f t-big" x="194" y="29">›</text>
    <rect class="t-s2 t-ln" x="40" y="42" width="190" height="122" rx="7"/>
    <text class="t-mu-f" x="50" y="60">2</text><rect class="t-pitch" x="60" y="50" width="30" height="16" rx="2"/><text class="t-txt-f" x="96" y="61">Playing out – bad</text>
    <rect class="t-wh" x="46" y="72" width="178" height="24" rx="5"/>
    <text class="t-ink" x="50" y="88">3</text><rect class="t-pitch" x="60" y="76" width="30" height="16" rx="2"/><text class="t-ink t-b" x="96" y="87">Press from goal kick</text>
    <text class="t-mu-f" x="50" y="114">4</text><rect class="t-pitch" x="60" y="104" width="30" height="16" rx="2"/><text class="t-txt-f" x="96" y="115">Counter after turnover</text>
    <text class="t-mu-f" x="50" y="142">5</text><rect class="t-pitch" x="60" y="132" width="30" height="16" rx="2"/><text class="t-txt-f" x="96" y="143">Back post defending</text>`,
  share: `
    <rect class="t-s1 t-ln" x="20" y="34" width="110" height="72" rx="6"/><rect class="t-pitch" x="28" y="42" width="94" height="56" rx="3"/>
    <path class="t-s3" d="M8 110h134l-8 8H16z"/>
    <rect class="t-s1 t-ln" x="226" y="28" width="56" height="100" rx="8"/><rect class="t-pitch" x="231" y="40" width="46" height="76" rx="3"/>
    <path class="t-acc-ln" d="M140 72h76M206 64l10 8-10 8"/>
    <g transform="translate(158 92)"><path class="t-s2 t-ln" d="M0 0h30l10 10v34H0z"/><path class="t-ln" d="M30 0v10h10"/><rect class="t-club" x="4" y="30" width="32" height="9" rx="2"/></g>
    <text class="t-mu-f" x="178" y="152" text-anchor="middle">Vs Rovers.analysis</text>`,
};

const STEPS: Step[] = [
  {
    title: 'Welcome to Match Analysis',
    art: '',
    body: [
      h('p', null, 'Turn match footage into a team talk: put your clips in order, mark the key moments, draw on them, then present them to the squad.'),
      h('p', null, 'This quick tour shows how to prepare a session and how to present it. It takes about a minute.'),
    ],
  },
  {
    part: 'Prepare a session',
    title: 'Start a session',
    art: ART.sessions,
    body: [
      h('p', null, 'A session is one team talk: a match, a half, or a training theme.'),
      h('p', null, 'Tap ', h('b', null, 'New session'), ' on the home page and give it a name, like “vs Rovers – 2nd half”. Your sessions are listed underneath.'),
    ],
  },
  {
    part: 'Prepare a session',
    title: 'Add your clips',
    art: ART.clips,
    body: [
      h('p', null, 'Tap ', h('b', null, 'Add clips'), ' or drop video files onto the session. Each clip becomes a slide. Drag slides to put them in order.'),
      h('p', null, 'Give each clip a title and comments: the comments sit beside the clip when you present. MP4 video plays on every device.'),
    ],
  },
  {
    part: 'Prepare a session',
    title: 'Mark the key moments',
    art: ART.shortcuts,
    body: [
      h('p', null, 'Pause on a moment that matters and tap ', h('b', null, 'Add shortcut'), ' (or press ', ...kbd('M'), '). Name it, like “Ball won back”.'),
      h('p', null, 'When you present, each shortcut is a button, and keys ', ...kbd('1'), '–', ...kbd('9'), ' jump straight to it.'),
    ],
  },
  {
    part: 'Prepare a session',
    title: 'Draw on a moment',
    art: ART.draw,
    body: [
      h('p', null, 'Tap ', h('b', null, 'Draw on this frame'), ' or ', h('b', null, 'Draw'), ' on a shortcut: arrows for passes, dashed lines for runs, rings and freehand.'),
      h('p', null, h('b', null, 'Auto-ring'), ': tap a player and a ring snaps under their feet. Drawings are saved with the shortcut and appear when you jump to it.'),
    ],
  },
  {
    part: 'Present a session',
    title: 'Present to the squad',
    art: ART.present,
    body: [
      h('p', null, 'Tap ', h('b', null, 'Present'), '. The clip gets the screen, with controls below it and your shortcuts and comments beside it.'),
      h(
        'p',
        { class: 'tour-keys' },
        ...kbd('Space'), ' play / pause  ',
        ...kbd('←', '→'), ' one frame  ',
        ...kbd('S'), ' slow motion  ',
        ...kbd('1'), '–', ...kbd('9'), ' shortcuts  ',
        ...kbd('F'), ' fullscreen',
      ),
    ],
  },
  {
    part: 'Present a session',
    title: 'Move between clips',
    art: ART.navigate,
    body: [
      h('p', null, 'Use ‹ › beside the title, or ', ...kbd('↑', '↓'), ' and ', ...kbd('PageUp', 'PageDown'), ': presentation clickers work too.'),
      h('p', null, 'Tap the title (or press ', ...kbd('G'), ') to see every clip and jump to any of them. You can draw live while presenting; those drawings aren’t saved.'),
    ],
  },
  {
    title: 'Take it with you',
    art: ART.share,
    body: [
      h('p', null, 'Everything stays on this device; nothing is uploaded. To move a session to a laptop, tablet or phone, tap ', h('b', null, 'Export'), ' to save it as one file, then ', h('b', null, 'Import session'), ' on the other device.'),
      h('p', null, 'Install the app from your browser’s menu and it works offline. Open this tour again any time from ', h('b', null, 'How it works'), ' on the home page.'),
    ],
  },
];

/** Opens the tour. Resolves when it's closed (finished or skipped). */
export function openTour(): Promise<void> {
  markSeen();
  let at = 0;
  const art = h('div', { class: 'tour-art', 'aria-hidden': 'true' });
  const part = h('p', { class: 'tour-part' });
  const title = h('h2', { id: 'tour-title' });
  const body = h('div', { class: 'tour-body' });
  const dots = h('div', { class: 'tour-dots', 'aria-hidden': 'true' }, ...STEPS.map(() => h('span')));
  const progress = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  const back = h('button', { class: 'btn', type: 'button', onclick: () => show(at - 1) }, 'Back');
  const next = h('button', { class: 'btn primary', type: 'button', onclick: () => (at === STEPS.length - 1 ? d.close() : show(at + 1)) });
  const skip = h('button', { class: 'btn tour-skip', type: 'button', onclick: () => d.close() }, 'Skip tour');

  const d = h(
    'dialog',
    { class: 'dialog tour', 'aria-labelledby': 'tour-title' },
    h('div', { class: 'tour-top' }, part, h('span', { class: 'spacer' }), skip),
    h('div', { class: 'tour-main' }, art, h('div', { class: 'tour-text' }, title, body)),
    h('div', { class: 'tour-foot' }, dots, progress, h('span', { class: 'spacer' }), back, next),
  );

  function show(i: number) {
    if (i < 0 || i >= STEPS.length) return;
    at = i;
    const s = STEPS[i];
    art.innerHTML = s.art
      ? `<svg viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg">${s.art}</svg>`
      : `<img class="tour-crest" src="${CREST}" alt="">`;
    part.textContent = s.part ?? '';
    part.classList.toggle('none', !s.part);
    title.textContent = s.title;
    body.replaceChildren(...s.body.map((p) => p.cloneNode(true)));
    [...dots.children].forEach((dot, n) => dot.classList.toggle('on', n === i));
    progress.textContent = `Step ${i + 1} of ${STEPS.length}`;
    back.hidden = i === 0;
    skip.hidden = i === STEPS.length - 1;
    next.textContent = i === 0 ? 'Start the tour' : i === STEPS.length - 1 ? 'Get started' : 'Next';
    next.focus();
  }

  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'ArrowLeft') show(at - 1);
    else return;
    e.preventDefault();
  });
  // Swipe left / right on touch screens. Touch events, because a pointer
  // stream is cancelled as soon as the browser starts treating it as a scroll.
  let startX = 0;
  let startY = 0;
  d.addEventListener('touchstart', (e) => ((startX = e.touches[0].clientX), (startY = e.touches[0].clientY)), { passive: true });
  d.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(t.clientY - startY) * 1.5) show(at + (dx < 0 ? 1 : -1));
  });
  // Close if the page navigates away underneath (e.g. the browser's back button).
  const onNav = () => d.close();
  window.addEventListener('hashchange', onNav);

  document.body.append(d);
  d.showModal();
  show(0);
  return new Promise((resolve) =>
    d.addEventListener('close', () => {
      window.removeEventListener('hashchange', onNav);
      d.remove();
      resolve();
    }),
  );
}
