// Present mode: full-screen player with slide navigation, shortcuts,
// slow motion and frame stepping. Works with touch, mouse, keyboard and
// presentation clickers (which send PageUp/PageDown).
import { h, icon, iconBtn } from '../lib/dom';
import { getVideo } from '../lib/files';
import { stepFrame, watchFps } from '../lib/media';
import { getSession, getSlides, saveSlide } from '../lib/store';
import type { Slide } from '../lib/types';
import { fmtTime, isTyping } from '../lib/util';
import { go } from './actions';

const SPEEDS = [1, 0.5, 0.25];
let rememberedSpeed = 1;

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
  let hideTimer: number | undefined;
  let notesOpen = false;
  let loadToken = 0;

  const video = h('video', { class: 'present-video', playsInline: true, preload: 'auto' });
  const msg = h('div', { class: 'player-msg', hidden: true });
  const counter = h('span', { class: 'counter mono' });
  const title = h('h1', { class: 'present-title' });
  const notesBody = h('div', { class: 'notes-body' });
  const notesPanel = h('aside', { class: 'notes-panel', hidden: true }, h('h2', null, 'Comments'), notesBody);
  const chips = h('div', { class: 'chips' });
  const scrub = h('input', { class: 'scrub', type: 'range', min: '0', max: '1', step: 'any', value: '0', 'aria-label': 'Seek' });
  const tNow = h('span', { class: 'mono small' }, '0:00.0');
  const tDur = h('span', { class: 'mono small muted' }, '0:00');
  const playBtn = iconBtn('play', 'Play / pause (Space)', () => togglePlay(), 'ctl ctl-big');
  const speedBtn = h('button', { class: 'ctl speed mono', type: 'button', title: 'Playback speed (S)', onclick: () => cycleSpeed() }, '1×');
  const fsBtn = iconBtn('expand', 'Fullscreen (F)', () => toggleFullscreen(), 'ctl');
  const notesBtn = iconBtn('notes', 'Comments (N)', () => toggleNotes(), 'ctl');
  const prevBtn = iconBtn('prev', 'Previous clip (PageUp / ↑)', () => goTo(index - 1), 'ctl');
  const nextBtn = iconBtn('next', 'Next clip (PageDown / ↓)', () => goTo(index + 1), 'ctl');
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
        ['1 – 9', 'Jump to shortcut'],
        ['S', 'Change speed'],
        ['N', 'Show comments'],
        ['F', 'Fullscreen'],
        ['Esc', 'Exit'],
      ].flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]),
    ),
  );

  const stage = h('div', { class: 'stage' }, video, msg);
  const view = h(
    'div',
    { class: 'present' },
    stage,
    h(
      'div',
      { class: 'overlay top' },
      counter,
      title,
      h('span', { class: 'spacer' }),
      iconBtn('help', 'Keyboard shortcuts (?)', () => (helpPanel.hidden = !helpPanel.hidden), 'ctl'),
      notesBtn,
      iconBtn('close', 'Exit (Esc)', () => exit(), 'ctl'),
    ),
    notesPanel,
    helpPanel,
    h(
      'div',
      { class: 'overlay bottom' },
      chips,
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
        fsBtn,
        nextBtn,
      ),
    ),
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
    prevBtn.disabled = i === 0;
    nextBtn.disabled = i === slides.length - 1;
    renderChips(slide);
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
    showControls();
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

  function renderChips(slide: Slide) {
    chips.replaceChildren(
      ...slide.shortcuts.map((sc, n) =>
        h(
          'button',
          { class: 'chip', type: 'button', 'data-time': String(sc.time), title: n < 9 ? `Key ${n + 1}` : undefined, onclick: () => jumpTo(n) },
          h('span', { class: 'chip-key mono' }, n < 9 ? String(n + 1) : '•'),
          sc.title || fmtTime(sc.time),
        ),
      ),
    );
    chips.hidden = !slide.shortcuts.length;
  }

  function jumpTo(n: number) {
    const sc = slides[index].shortcuts[n];
    if (!sc) return;
    video.pause();
    video.currentTime = sc.time;
    showControls();
  }

  function highlightChip() {
    const t = video.currentTime;
    let active: Element | null = null;
    for (const c of chips.children) {
      if (Number((c as HTMLElement).dataset.time) <= t + 0.05) active = c;
      c.classList.remove('active');
    }
    active?.classList.add('active');
  }

  // ---------- playback ----------
  function togglePlay() {
    if (video.paused) {
      if (video.ended) video.currentTime = 0;
      video.play().catch(() => {});
    } else video.pause();
  }

  function cycleSpeed() {
    rememberedSpeed = SPEEDS[(SPEEDS.indexOf(rememberedSpeed) + 1) % SPEEDS.length];
    video.playbackRate = rememberedSpeed;
    video.defaultPlaybackRate = rememberedSpeed;
    speedBtn.textContent = `${rememberedSpeed}×`;
    speedBtn.classList.toggle('on', rememberedSpeed !== 1);
  }
  speedBtn.textContent = `${rememberedSpeed}×`;
  speedBtn.classList.toggle('on', rememberedSpeed !== 1);

  function syncTime() {
    const d = video.duration || 0;
    scrub.max = String(d || 1);
    if (!scrubbing) scrub.value = String(video.currentTime);
    tNow.textContent = fmtTime(video.currentTime);
    tDur.textContent = fmtTime(d, false);
    highlightChip();
  }

  let scrubbing = false;
  scrub.addEventListener('pointerdown', () => (scrubbing = true));
  scrub.addEventListener('pointerup', () => (scrubbing = false));
  scrub.addEventListener('input', () => {
    video.currentTime = Number(scrub.value);
    tNow.textContent = fmtTime(Number(scrub.value));
  });

  const setPlayIcon = () => {
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
    view.classList.toggle('playing', !video.paused);
    showControls();
  };
  video.addEventListener('play', setPlayIcon);
  video.addEventListener('pause', setPlayIcon);
  video.addEventListener('timeupdate', syncTime);
  video.addEventListener('seeked', syncTime);
  video.addEventListener('loadedmetadata', syncTime);
  video.addEventListener('error', () => {
    if (video.getAttribute('src')) showMsg("This browser can't play this clip's format. Re-export it as H.264 MP4.");
  });
  // Smooth scrubber while playing.
  let raf = 0;
  const tick = () => {
    if (!video.paused) syncTime();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // ---------- chrome ----------
  function showControls() {
    view.classList.remove('idle');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!video.paused && !notesOpen) view.classList.add('idle');
    }, 2500);
  }

  function toggleNotes() {
    notesOpen = !notesOpen;
    notesPanel.hidden = !notesOpen;
    notesBtn.classList.toggle('on', notesOpen);
    showControls();
  }

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

  // Click the video: play/pause with a mouse. Tap on touch screens shows/hides
  // the controls, so a paused frame can be shown without anything on top.
  stage.addEventListener('click', (e) => {
    if ((e as PointerEvent).pointerType === 'mouse') togglePlay();
    else if (view.classList.contains('idle')) showControls();
    else {
      clearTimeout(hideTimer);
      view.classList.add('idle');
    }
  });
  stage.addEventListener('dblclick', () => toggleFullscreen());
  view.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') showControls();
  });

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') togglePlay();
    else if (k === 'ArrowRight') e.shiftKey ? (video.currentTime = Math.min(video.duration || 0, video.currentTime + 2)) : stepFrame(video, 1, slides[index].fps);
    else if (k === 'ArrowLeft') e.shiftKey ? (video.currentTime = Math.max(0, video.currentTime - 2)) : stepFrame(video, -1, slides[index].fps);
    else if (k === 'PageDown' || k === 'ArrowDown') goTo(index + 1);
    else if (k === 'PageUp' || k === 'ArrowUp') goTo(index - 1);
    else if (k === 's' || k === 'S') cycleSpeed();
    else if (k === 'n' || k === 'N') toggleNotes();
    else if (k === 'f' || k === 'F') toggleFullscreen();
    else if (k === '?') helpPanel.hidden = !helpPanel.hidden;
    else if (k === 'Escape') {
      if (!helpPanel.hidden) helpPanel.hidden = true;
      // First Esc leaves fullscreen (browsers also do this themselves), second Esc exits present mode.
      else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else exit();
    } else if (/^[1-9]$/.test(k)) jumpTo(Number(k) - 1);
    else return;
    e.preventDefault();
    showControls();
  };
  document.addEventListener('keydown', onKey);

  await load(index);

  return () => {
    loadToken++;
    stopFps();
    cancelAnimationFrame(raf);
    clearTimeout(hideTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFsChange);
    document.body.classList.remove('presenting');
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (url) URL.revokeObjectURL(url);
  };
}
