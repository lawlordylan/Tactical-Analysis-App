// Present mode. The clip gets its own uncovered area; everything else sits
// around it:
//
//   ┌──────────── top bar: ‹ [n/N · title ▾] › · panel · help · fs · exit ┐
//   │ tools │              stage (video)              │ side panel:         │
//   │ rail  │                                         │  shortcuts          │
//   │       ├─────────────────────────────────────────┤  comments           │
//   │       │ transport: scrub · prev · frame · play… │                     │
//   └───────┴─────────────────────────────────────────┴─────────────────────┘
//
// On phones in portrait the tool rail sits above the clip and the side panel
// drops below the transport.
//
// Drawing: the tool rail draws on a canvas layered over the clip. A drawing
// belongs to a moment in the clip: jumping to a shortcut shows its saved
// drawing, and playing or seeking away clears the screen (frame steps keep it).
// Drawings made while presenting are not saved; prepare them in the editor.
//
// Clip picker: clicking the title (or G) lists every clip to jump to. It's
// the one thing allowed over the clip: it only opens when asked for, pauses
// the clip and closes as soon as a clip is picked. A popover under the title
// on larger screens, a bottom sheet on phones (CSS decides which).
//
// Works with touch, mouse, keyboard and presentation clickers (PageUp/PageDown).
import { h, icon, iconBtn } from '../lib/dom';
import { getVideo } from '../lib/files';
import { stepFrame, watchFps } from '../lib/media';
import { getSession, getSlides, saveSlide } from '../lib/store';
import type { Slide } from '../lib/types';
import { fmtTime, isTyping } from '../lib/util';
import { Annotator } from '../lib/draw';
import { CREST, go } from './actions';
import { drawBar } from './drawbar';

const SPEEDS = [1, 0.5, 0.25];
let rememberedSpeed = 1;
let rememberedPanel = true;

export async function renderPresent(root: HTMLElement, sessionId: string, startIndex: number): Promise<() => void> {
  const session = await getSession(sessionId);
  const slides = session ? await getSlides(session) : [];
  if (!session || !slides.length) {
    go(session ? `#/session/${sessionId}` : '#/');
    return () => {};
  }

  let index = Math.min(Math.max(0, startIndex || 0), slides.length - 1);
  let url: string | null = null;
  let stopFps = () => {};
  let loadToken = 0;

  // ---------- elements ----------
  const video = h('video', { class: 'present-video', playsInline: true, preload: 'auto' });
  const msg = h('div', { class: 'player-msg', hidden: true });
  const stage = h('div', { class: 'stage' }, video, msg);

  const counter = h('span', { class: 'counter mono' });
  const title = h('span', { class: 'present-title' });
  const pickerBtn = h(
    'button',
    { class: 'clip-picker', type: 'button', title: 'All clips (G)', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => togglePicker() },
    counter,
    title,
    icon('down'),
  );
  const titlePrev = iconBtn('back', 'Previous clip (PageUp / ↑)', () => goTo(index - 1), 'clip-step');
  const titleNext = iconBtn('forward', 'Next clip (PageDown / ↓)', () => goTo(index + 1), 'clip-step');

  const pickerList = h('ol', { class: 'clip-list' });
  const pickerCount = h('span', { class: 'clip-menu-count mono' });
  const picker = h(
    'div',
    { class: 'clip-menu', role: 'dialog', 'aria-label': 'All clips', hidden: true },
    h('div', { class: 'clip-menu-head' }, h('h2', null, 'Clips'), pickerCount, h('span', { class: 'spacer' }), iconBtn('close', 'Close (Esc)', () => closePicker(), 'ctl clip-menu-close')),
    pickerList,
    h('p', { class: 'clip-menu-hint' }, '↑ ↓ then Enter  ·  type a clip number  ·  Esc to close'),
  );
  const pickerBackdrop = h('div', { class: 'clip-menu-backdrop', hidden: true, onclick: () => closePicker() });

  const shortcutList = h('ol', { class: 'sc-list' });
  const shortcutSection = h('section', { class: 'side-section' }, h('h2', null, 'Shortcuts'), shortcutList);
  const notesBody = h('div', { class: 'notes-body' });
  const notesSection = h('section', { class: 'side-section' }, h('h2', null, 'Comments'), notesBody);
  const side = h('aside', { class: 'present-side' }, shortcutSection, notesSection);

  // ---------- drawing ----------
  const ann = new Annotator(stage, video);
  /** Clip time the current drawing belongs to; null when nothing is drawn. */
  let shownAt: number | null = null;
  const bar = drawBar(ann, { cls: 'rail', video });
  const toolRail = h('div', { class: 'tool-rail', 'aria-label': 'Drawing tools' }, bar.el);
  ann.onStroke = () => {
    video.pause();
    shownAt = video.currentTime;
  };
  ann.onChange = () => bar.refresh();
  function showDrawing(shapes: Slide['shortcuts'][number]['drawing'], at: number | null) {
    ann.setShapes(shapes);
    shownAt = shapes?.length ? at : null;
    bar.refresh();
  }
  /** Clear the drawing once the clip has moved away from its moment. */
  function clearIfMoved() {
    if (shownAt !== null && Math.abs(video.currentTime - shownAt) > 0.5) showDrawing([], null);
  }

  const scrub = h('input', { class: 'scrub', type: 'range', min: '0', max: '1', step: 'any', value: '0', 'aria-label': 'Seek' });
  const tNow = h('span', { class: 'mono small' }, '0:00.0');
  const tDur = h('span', { class: 'mono small muted' }, '0:00');
  const playBtn = iconBtn('play', 'Play / pause (Space)', () => togglePlay(), 'ctl ctl-big');
  const speedBtn = h('button', { class: 'ctl speed mono', type: 'button', title: 'Playback speed (S)', onclick: () => cycleSpeed() }, '1×');
  const prevBtn = iconBtn('prev', 'Previous clip (PageUp / ↑)', () => goTo(index - 1), 'ctl');
  const nextBtn = iconBtn('next', 'Next clip (PageDown / ↓)', () => goTo(index + 1), 'ctl');
  const fsBtn = iconBtn('expand', 'Fullscreen (F)', () => toggleFullscreen(), 'ctl');
  const panelBtn = iconBtn('notes', 'Show / hide panel (N)', () => togglePanel(), 'ctl');

  const transport = h(
    'div',
    { class: 'transport' },
    h('div', { class: 'scrub-row' }, tNow, scrub, tDur),
    h(
      'div',
      { class: 'controls' },
      prevBtn,
      h('span', { class: 'spacer' }),
      iconBtn('frameBack', 'Previous frame (←)', () => stepFrame(video, -1, slides[index].fps), 'ctl'),
      playBtn,
      iconBtn('frameFwd', 'Next frame (→)', () => stepFrame(video, 1, slides[index].fps), 'ctl'),
      speedBtn,
      h('span', { class: 'spacer' }),
      nextBtn,
    ),
  );

  const helpPanel = h(
    'div',
    { class: 'help-panel', hidden: true, onclick: () => (helpPanel.hidden = true) },
    h(
      'dl',
      null,
      ...[
        ['Space / K', 'Play / pause'],
        ['← →', 'Step one frame'],
        ['Shift + ← →', 'Jump 2 seconds'],
        ['↑ ↓ / PageUp PageDown', 'Previous / next clip'],
        ['G', 'All clips: pick one to jump to'],
        ['1 – 9', 'Jump to shortcut'],
        ['S', 'Change speed'],
        ['N', 'Show / hide panel'],
        ['R', 'Auto-ring: tap a player'],
        ['A  L  C  P', 'Arrow, line, ring, freehand'],
        ['D', 'Dashed / solid line'],
        ['Z  ·  X', 'Undo  ·  clear drawing'],
        ['F', 'Fullscreen'],
        ['Esc', 'Exit'],
      ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
    ),
  );

  const view = h(
    'div',
    { class: 'present' },
    h(
      'header',
      { class: 'present-top' },
      h('img', { class: 'present-crest', src: CREST, alt: '' }),
      titlePrev,
      h('h1', { class: 'clip-heading' }, pickerBtn),
      titleNext,
      h('span', { class: 'spacer' }),
      panelBtn,
      iconBtn('help', 'Keyboard shortcuts (?)', () => (helpPanel.hidden = !helpPanel.hidden), 'ctl help-btn'),
      fsBtn,
      iconBtn('close', 'Exit (Esc)', () => exit(), 'ctl'),
    ),
    h('div', { class: 'present-body' }, toolRail, h('div', { class: 'present-main' }, stage, transport), side),
    helpPanel,
    pickerBackdrop,
    picker,
  );
  root.append(view);
  document.body.classList.add('presenting');

  // ---------- slide loading ----------
  async function load(i: number) {
    const token = ++loadToken;
    const slide = slides[i];
    stopFps();
    video.pause();
    msg.hidden = true;
    counter.textContent = `${i + 1} / ${slides.length}`;
    title.textContent = slide.title || 'Untitled clip';
    notesBody.textContent = slide.notes || 'No comments for this clip.';
    notesBody.classList.toggle('muted', !slide.notes);
    prevBtn.disabled = titlePrev.disabled = i === 0;
    nextBtn.disabled = titleNext.disabled = i === slides.length - 1;
    renderShortcuts(slide);
    showDrawing([], null);
    history.replaceState(null, '', `#/present/${sessionId}/${i}`);

    if (url) URL.revokeObjectURL(url);
    url = null;
    if (!slide.video) {
      video.removeAttribute('src');
      showMsg('This slide has no clip.');
      return;
    }
    try {
      const blob = await getVideo(slide.video);
      if (token !== loadToken) return;
      url = URL.createObjectURL(blob);
      video.src = url;
      video.defaultPlaybackRate = rememberedSpeed;
      video.playbackRate = rememberedSpeed;
    } catch (e) {
      showMsg((e as Error).message);
    }
    if (!slide.fps) {
      stopFps = watchFps(video, (fps) => {
        slide.fps = fps;
        saveSlide(slide).catch(() => {});
      });
    }
  }

  function showMsg(text: string) {
    msg.textContent = text;
    msg.hidden = false;
  }

  function goTo(i: number) {
    if (i < 0 || i >= slides.length || i === index) return;
    index = i;
    load(index);
  }

  // ---------- clip picker ----------
  let pickerOpen = false;
  let typed = '';
  let typedTimer = 0;
  const pickerRows = () => [...pickerList.querySelectorAll<HTMLButtonElement>('.clip-row')];

  function clipMeta(s: Slide) {
    const n = s.shortcuts.length;
    return [s.video ? (s.duration ? fmtTime(s.duration, false) : '') : 'No clip', n ? `${n} shortcut${n === 1 ? '' : 's'}` : '']
      .filter(Boolean)
      .join('  ·  ');
  }

  function openPicker() {
    if (pickerOpen) return;
    pickerOpen = true;
    video.pause();
    helpPanel.hidden = true;
    pickerCount.textContent = String(slides.length);
    pickerList.replaceChildren(
      ...slides.map((s, i) =>
        h(
          'li',
          null,
          h(
            'button',
            { class: 'clip-row', type: 'button', 'aria-current': i === index ? 'true' : null, onclick: () => pickClip(i) },
            h('span', { class: 'clip-num mono' }, String(i + 1)),
            s.thumb ? h('img', { class: 'clip-thumb', src: s.thumb, alt: '' }) : h('span', { class: 'clip-thumb' }),
            h('span', { class: 'clip-text' }, h('span', { class: 'clip-name' }, s.title || 'Untitled clip'), h('span', { class: 'clip-meta' }, clipMeta(s))),
          ),
        ),
      ),
    );
    picker.hidden = pickerBackdrop.hidden = false;
    pickerBtn.setAttribute('aria-expanded', 'true');
    placePicker();
    const current = pickerRows()[index];
    current?.scrollIntoView({ block: 'center' });
    current?.focus({ preventScroll: true });
  }

  /** Popover position under the title. Phones ignore it: the sheet sits at the bottom. */
  function placePicker() {
    const r = pickerBtn.getBoundingClientRect();
    const width = Math.min(440, innerWidth - 24);
    picker.style.setProperty('--menu-left', `${Math.max(12, Math.min(r.left, innerWidth - width - 12))}px`);
    picker.style.setProperty('--menu-top', `${r.bottom + 6}px`);
  }

  function closePicker() {
    if (!pickerOpen) return;
    pickerOpen = false;
    typed = '';
    picker.hidden = pickerBackdrop.hidden = true;
    pickerBtn.setAttribute('aria-expanded', 'false');
    // Keep focus off buttons so Space means play/pause again.
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  const togglePicker = () => (pickerOpen ? closePicker() : openPicker());

  function pickClip(i: number) {
    closePicker();
    goTo(i);
  }

  /** Keys while the picker is open. Everything else in present mode waits until it closes. */
  function pickerKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab') return;
    const rows = pickerRows();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const focusRow = (i: number) => rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();
    const k = e.key;
    e.preventDefault();
    if (k === 'Escape' || k === 'g' || k === 'G') closePicker();
    else if (k === 'ArrowDown' || k === 'PageDown') focusRow(at < 0 ? index : at + 1);
    else if (k === 'ArrowUp' || k === 'PageUp') focusRow(at < 0 ? index : at - 1);
    else if (k === 'Home') focusRow(0);
    else if (k === 'End') focusRow(rows.length - 1);
    else if (k === 'Enter' || k === ' ') pickClip(at < 0 ? index : at);
    else if (/^[0-9]$/.test(k)) {
      // Digits pick out a clip number ("1", "2" → 12), then Enter goes there.
      clearTimeout(typedTimer);
      typed = (typed + k).replace(/^0+/, '');
      if (Number(typed) > rows.length) typed = k === '0' ? '' : k;
      if (typed) focusRow(Number(typed) - 1);
      typedTimer = window.setTimeout(() => (typed = ''), 1200);
    }
  }

  const onResize = () => pickerOpen && placePicker();
  window.addEventListener('resize', onResize);

  function renderShortcuts(slide: Slide) {
    shortcutList.replaceChildren(
      ...slide.shortcuts.map((sc, n) =>
        h(
          'li',
          null,
          h(
            'button',
            { class: 'sc-btn', type: 'button', 'data-time': String(sc.time), onclick: () => jumpTo(n) },
            h('span', { class: 'sc-key mono' }, n < 9 ? String(n + 1) : '•'),
            h('span', { class: 'sc-title' }, sc.title || 'Untitled'),
            h('span', { class: 'sc-time mono' }, fmtTime(sc.time)),
          ),
        ),
      ),
    );
    shortcutSection.hidden = !slide.shortcuts.length;
  }

  function jumpTo(n: number) {
    const sc = slides[index].shortcuts[n];
    if (!sc) return;
    video.pause();
    video.currentTime = sc.time;
    showDrawing(sc.drawing, sc.time);
  }

  function highlightShortcut() {
    const t = video.currentTime;
    let active: Element | null = null;
    for (const b of shortcutList.querySelectorAll('.sc-btn')) {
      if (Number((b as HTMLElement).dataset.time) <= t + 0.05) active = b;
      b.classList.remove('active');
    }
    active?.classList.add('active');
  }

  // ---------- playback ----------
  function togglePlay() {
    if (!video.getAttribute('src')) return;
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {});
    } else video.pause();
  }

  function setSpeedLabel() {
    speedBtn.textContent = `${rememberedSpeed}×`;
    speedBtn.classList.toggle('on', rememberedSpeed !== 1);
  }
  function cycleSpeed() {
    rememberedSpeed = SPEEDS[(SPEEDS.indexOf(rememberedSpeed) + 1) % SPEEDS.length];
    video.playbackRate = rememberedSpeed;
    video.defaultPlaybackRate = rememberedSpeed;
    setSpeedLabel();
  }
  setSpeedLabel();

  let scrubbing = false;
  function syncTime() {
    const d = video.duration || 0;
    scrub.max = String(d || 1);
    if (!scrubbing) scrub.value = String(video.currentTime);
    tNow.textContent = fmtTime(video.currentTime);
    tDur.textContent = fmtTime(d, false);
    highlightShortcut();
    clearIfMoved();
  }
  scrub.addEventListener('pointerdown', () => (scrubbing = true));
  scrub.addEventListener('pointerup', () => (scrubbing = false));
  scrub.addEventListener('input', () => {
    video.currentTime = Number(scrub.value);
    tNow.textContent = fmtTime(Number(scrub.value));
  });

  const setPlayIcon = () => {
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    if (!video.paused) showDrawing([], null);
    view.classList.toggle('playing', !video.paused);
  };
  video.addEventListener('play', setPlayIcon);
  video.addEventListener('pause', setPlayIcon);
  video.addEventListener('timeupdate', syncTime);
  video.addEventListener('seeked', syncTime);
  video.addEventListener('loadedmetadata', () => {
    // Lets the stage size itself to the clip when stacked on portrait phones.
    if (video.videoWidth && video.videoHeight) stage.style.setProperty('--clip-ratio', `${video.videoWidth} / ${video.videoHeight}`);
    syncTime();
  });
  video.addEventListener('error', () => {
    if (video.getAttribute('src')) showMsg("This browser can't play this clip's format. Re-export it as H.264 MP4.");
  });
  // Smooth scrubber and shortcut highlight while playing.
  let raf = 0;
  const tick = () => {
    if (!video.paused) syncTime();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // ---------- layout ----------
  function applyPanel() {
    view.classList.toggle('panel-hidden', !rememberedPanel);
    panelBtn.classList.toggle('on', rememberedPanel);
  }
  function togglePanel() {
    rememberedPanel = !rememberedPanel;
    applyPanel();
  }
  applyPanel();

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }
  const onFsChange = () => {
    fsBtn.replaceChildren(icon(document.fullscreenElement ? 'shrink' : 'expand'));
    if (document.fullscreenElement) {
      // Android: prefer landscape while presenting. Ignored where unsupported.
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
    }
  };
  document.addEventListener('fullscreenchange', onFsChange);
  onFsChange();

  function exit() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    go(`#/session/${sessionId}/${slides[index].id}`);
  }

  // Click or tap the clip to play / pause. Nothing sits on top of it any more.
  stage.addEventListener('click', () => {
    if (!ann.tool) togglePlay();
  });
  stage.addEventListener('dblclick', (e) => {
    if ((e as MouseEvent).detail === 2) toggleFullscreen();
  });

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    if (pickerOpen) return pickerKey(e);
    if ((e.key === 'g' || e.key === 'G') && !(e.ctrlKey || e.metaKey || e.altKey)) {
      e.preventDefault();
      openPicker();
      return;
    }
    if (helpPanel.hidden && bar.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') togglePlay();
    else if (k === 'ArrowRight') e.shiftKey ? (video.currentTime = Math.min(video.duration || 0, video.currentTime + 2)) : stepFrame(video, 1, slides[index].fps);
    else if (k === 'ArrowLeft') e.shiftKey ? (video.currentTime = Math.max(0, video.currentTime - 2)) : stepFrame(video, -1, slides[index].fps);
    else if (k === 'PageDown' || k === 'ArrowDown') goTo(index + 1);
    else if (k === 'PageUp' || k === 'ArrowUp') goTo(index - 1);
    else if (k === 's' || k === 'S') cycleSpeed();
    else if (k === 'n' || k === 'N') togglePanel();
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === '?') helpPanel.hidden = !helpPanel.hidden;
    else if (k === 'Escape') {
      // First Esc leaves fullscreen (browsers also do this themselves), second Esc exits present mode.
      if (!helpPanel.hidden) helpPanel.hidden = true;
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else exit();
    } else if (/^[1-9]$/.test(k)) jumpTo(Number(k) - 1);
    else return;
    e.preventDefault();
    // Keep focus off buttons so Space always means play/pause, not "click the last button".
    (document.activeElement as HTMLElement | null)?.blur?.();
  };
  document.addEventListener('keydown', onKey);

  await load(index);

  return () => {
    loadToken++;
    bar.destroy();
    ann.destroy();
    stopFps();
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    window.removeEventListener('resize', onResize);
    clearTimeout(typedTimer);
    document.body.classList.remove('presenting');
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (url) URL.revokeObjectURL(url);
  };
}
