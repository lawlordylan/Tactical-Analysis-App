// Session editor: slide list on the left (strip on top on phones), selected slide on the right.
import { alertDialog, confirmDialog, progressDialog, toast } from '../lib/dialogs';
import { h, icon, iconBtn } from '../lib/dom';
import { getVideo } from '../lib/files';
import { stepFrame, watchFps } from '../lib/media';
import { addClips, deleteSlide, getSession, getSlides, moveSlide, saveSession, saveSlide } from '../lib/store';
import { Annotator } from '../lib/draw';
import { sortable } from '../lib/sortable';
import type { Session, Shortcut, Slide } from '../lib/types';
import { debounce, fmtBytes, fmtTime, isTyping, uid } from '../lib/util';
import { CREST, go, runExport, startPresenting } from './actions';
import { drawBar } from './drawbar';

export async function renderEditor(root: HTMLElement, sessionId: string, initialSlide?: string): Promise<() => void> {
  const loaded = await getSession(sessionId);
  if (!loaded) {
    root.append(h('main', { class: 'home' }, h('p', null, 'Session not found. '), h('a', { href: '#/' }, 'Back to sessions')));
    return () => {};
  }
  const session: Session = loaded;
  let slides: Slide[] = await getSlides(session);
  let selectedId: string | null = initialSlide && slides.some((s) => s.id === initialSlide) ? initialSlide : (slides[0]?.id ?? null);
  let cleanupDetail: () => void = () => {};

  const fileInput = h('input', { type: 'file', accept: 'video/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) uploadFiles(files);
  });

  const saveTitle = debounce(() => saveSession(session), 400);
  const titleInput = h('input', {
    class: 'title-input',
    type: 'text',
    value: session.title,
    'aria-label': 'Session title',
    oninput: () => {
      session.title = titleInput.value || 'Untitled session';
      saveTitle();
    },
  });

  const listEl = h('ol', { class: 'slide-list', 'aria-label': 'Clips. Drag to reorder.' });
  /** Updates the selected slide's move up/down buttons after the order changes. */
  let refreshMoveBtns: () => void = () => {};
  const stopSortable = sortable(listEl, {
    item: 'li',
    handle: '.drag-handle',
    onMove: async (from, to) => {
      const ids = [...session.slideIds];
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      session.slideIds = ids;
      const [ms] = slides.splice(from, 1);
      slides.splice(to, 0, ms);
      renderList();
      refreshMoveBtns();
      await saveSession(session);
    },
  });
  const detailEl = h('section', { class: 'slide-detail' });
  const selectedIndex = () => Math.max(0, slides.findIndex((s) => s.id === selectedId));

  root.append(
    h(
      'header',
      { class: 'topbar' },
      iconBtn('back', 'All sessions', () => go('#/')),
      h('img', { class: 'present-crest', src: CREST, alt: '' }),
      titleInput,
      h(
        'div',
        { class: 'topbar-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => runExport(session) }, icon('export'), h('span', { class: 'label' }, 'Export')),
        h(
          'button',
          { class: 'btn primary', type: 'button', onclick: () => (slides.length ? startPresenting(session.id, 0) : toast('Add clips before presenting')) },
          icon('present'),
          h('span', { class: 'label' }, 'Present'),
        ),
      ),
    ),
    h(
      'div',
      { class: 'editor' },
      h(
        'aside',
        { class: 'slide-rail' },
        listEl,
        h('button', { class: 'btn add-clips', type: 'button', onclick: () => fileInput.click() }, icon('plus'), 'Add clips'),
      ),
      detailEl,
    ),
    fileInput,
  );

  // ---- uploads (button or drag & drop) ----
  async function uploadFiles(files: File[]) {
    const videos = files.filter((f) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(f.name));
    if (!videos.length) return toast('Those files are not videos');
    const total = videos.reduce((n, f) => n + f.size, 0);
    const p = progressDialog(videos.length === 1 ? 'Adding clip' : `Adding ${videos.length} clips`);
    let before = 0;
    let lastIndex = -1;
    try {
      const created = await addClips(session, videos, (i, d) => {
        if (i !== lastIndex) {
          if (lastIndex >= 0) before += videos[lastIndex].size;
          lastIndex = i;
        }
        p.update((before + d) / total, `${videos[i].name} · ${fmtBytes(before + d)} of ${fmtBytes(total)}`);
      });
      slides = await getSlides(session);
      selectedId = created[0]?.id ?? selectedId;
      renderList();
      renderDetail();
    } catch (e) {
      await alertDialog('Could not add clip', (e as Error).message);
      slides = await getSlides(session);
      renderList();
      renderDetail();
    } finally {
      p.close();
    }
  }

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      root.classList.add('dropping');
    }
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.relatedTarget) root.classList.remove('dropping');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    root.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) uploadFiles(files);
  };
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);

  // ---- slide list ----
  function renderList() {
    listEl.replaceChildren(
      ...slides.map((s, i) =>
        h(
          'li',
          { 'data-id': s.id },
          h(
            'button',
            {
              type: 'button',
              class: `slide-item${s.id === selectedId ? ' selected' : ''}`,
              'data-id': s.id,
              onclick: () => {
                if (s.id === selectedId) return;
                selectedId = s.id;
                renderList();
                renderDetail();
              },
            },
            h('span', { class: 'slide-num' }, String(i + 1)),
            h('span', { class: 'slide-thumb' }, s.thumb ? h('img', { src: s.thumb, alt: '' }) : icon('film')),
            h(
              'span',
              { class: 'slide-text' },
              h('span', { class: 'slide-title' }, s.title || 'Untitled clip'),
              h('span', { class: 'muted small' }, [s.duration ? fmtTime(s.duration, false) : null, s.shortcuts.length ? `${s.shortcuts.length} ⚑` : null].filter(Boolean).join(' · ')),
            ),
            h('span', { class: 'drag-handle', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip')),
          ),
        ),
      ),
    );
    listEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function updateListItem(slide: Slide) {
    const item = listEl.querySelector(`.slide-item[data-id="${slide.id}"]`);
    if (!item) return;
    item.querySelector('.slide-title')!.textContent = slide.title || 'Untitled clip';
    item.querySelector('.slide-text .muted')!.textContent = [slide.duration ? fmtTime(slide.duration, false) : null, slide.shortcuts.length ? `${slide.shortcuts.length} ⚑` : null]
      .filter(Boolean)
      .join(' · ');
  }

  // ---- selected slide ----
  function renderDetail() {
    cleanupDetail();
    cleanupDetail = () => {};
    detailEl.replaceChildren();
    const slide = slides.find((s) => s.id === selectedId);
    if (!slide) {
      detailEl.append(
        h(
          'div',
          { class: 'empty dropzone', onclick: () => fileInput.click() },
          h('div', { class: 'empty-icon' }, icon('film')),
          h('h2', null, 'Add your clips'),
          h('p', { class: 'muted' }, 'Tap to choose video files, or drag them here. Each clip becomes one slide.'),
          h('p', { class: 'muted small' }, 'Tip: H.264 MP4 plays on every device.'),
        ),
      );
      return;
    }
    cleanupDetail = buildDetail(slide);
  }

  function buildDetail(slide: Slide): () => void {
    const save = debounce(() => saveSlide(slide, session), 400);
    const video = h('video', { class: 'editor-video', controls: true, playsInline: true, preload: 'auto' });
    const playerMsg = h('div', { class: 'player-msg', hidden: true });
    let url: string | null = null;
    let stopFps = () => {};

    if (slide.video) {
      getVideo(slide.video)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          video.src = url;
        })
        .catch((e) => {
          playerMsg.hidden = false;
          playerMsg.textContent = (e as Error).message;
        });
    }
    video.addEventListener('error', () => {
      playerMsg.hidden = false;
      playerMsg.textContent = "This browser can't play this clip's format. Re-export it as H.264 MP4 and add it again.";
    });
    video.addEventListener('loadedmetadata', () => {
      if (isFinite(video.duration) && Math.abs((slide.duration ?? 0) - video.duration) > 0.05) {
        slide.duration = video.duration;
        save();
        updateListItem(slide);
      }
    });
    video.addEventListener('play', () => {
      if (slide.fps) return;
      stopFps();
      stopFps = watchFps(video, (fps) => {
        slide.fps = fps;
        save();
        fpsNote.textContent = `${fps} fps`;
      });
    });

    const timeLabel = h('span', { class: 'mono' }, fmtTime(0));
    const onTime = () => {
      timeLabel.textContent = fmtTime(video.currentTime);
      clearIfMoved();
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', onTime);

    // ---- drawing ----
    // A shortcut's drawing shows when you jump to it, and is edited in "draw mode":
    // the clip is held on the shortcut's frame and the drawing tools replace the
    // playback row. Every change saves straight to the shortcut.
    const player = h('div', { class: 'player' }, video, playerMsg);
    const ann = new Annotator(player, video);
    let shownAt: number | null = null;
    let editing: Shortcut | null = null;
    const drawBtns = new Map<string, HTMLButtonElement>();
    const drawLabel = h('span', { class: 'draw-label' });
    const doneBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => exitDraw() }, icon('check'), 'Done');
    const bar = drawBar(ann, { cls: 'inline', video });
    const drawTools = h('div', { class: 'player-tools draw-tools', hidden: true }, drawLabel, bar.el, h('span', { class: 'spacer' }), doneBtn);

    function showDrawing(shapes: Shortcut['drawing'], at: number | null) {
      ann.setShapes(shapes);
      shownAt = shapes?.length ? at : null;
      bar.refresh();
    }
    function clearIfMoved() {
      if (!editing && shownAt !== null && Math.abs(video.currentTime - shownAt) > 0.5) showDrawing([], null);
    }
    video.addEventListener('play', () => {
      if (!editing) showDrawing([], null);
    });
    ann.onStroke = () => video.pause();
    ann.onChange = (shapes) => {
      bar.refresh();
      if (!editing) return;
      editing.drawing = shapes.length ? shapes : undefined;
      shownAt = editing.time;
      save();
      markDrawBtn(editing);
    };

    function markDrawBtn(sc: Shortcut) {
      const b = drawBtns.get(sc.id);
      if (!b) return;
      const has = !!sc.drawing?.length;
      b.classList.toggle('has', has);
      b.classList.toggle('on', editing === sc);
      b.title = editing === sc ? 'Finish drawing' : has ? 'Edit drawing' : 'Add a drawing to this shortcut';
      b.setAttribute('aria-label', b.title);
      const label = b.querySelector('.draw-btn-label');
      if (label) label.textContent = editing === sc ? 'Drawing…' : has ? `Drawing · ${sc.drawing!.length}` : 'Draw';
    }

    function enterDraw(sc: Shortcut) {
      if (!video.getAttribute('src')) return toast('This slide has no playable clip');
      const prev = editing;
      editing = sc;
      if (prev) markDrawBtn(prev);
      video.pause();
      video.controls = false;
      video.currentTime = sc.time;
      showDrawing(sc.drawing, sc.time);
      drawLabel.replaceChildren(h('span', { class: 'chip static' }, fmtTime(sc.time)), h('span', { class: 'draw-label-text' }, sc.title || 'Shortcut'));
      playerTools.hidden = true;
      drawTools.hidden = false;
      player.classList.add('drawing');
      bar.setTool(ann.tool ?? 'arrow');
      markDrawBtn(sc);
      player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function exitDraw() {
      if (!editing) return;
      const sc = editing;
      editing = null;
      bar.setTool(null);
      video.controls = true;
      playerTools.hidden = false;
      drawTools.hidden = true;
      player.classList.remove('drawing');
      markDrawBtn(sc);
    }

    // Shortcuts
    const shortcutList = h('ul', { class: 'shortcut-list' });
    const renderShortcuts = (focusId?: string) => {
      slide.shortcuts.sort((a, b) => a.time - b.time);
      shortcutList.replaceChildren(
        ...(slide.shortcuts.length
          ? slide.shortcuts.map((sc) => {
              const input = h('input', {
                class: 'input',
                type: 'text',
                value: sc.title,
                placeholder: 'Shortcut title',
                'aria-label': 'Shortcut title',
                oninput: () => {
                  sc.title = input.value;
                  save();
                },
              });
              if (sc.id === focusId) queueMicrotask(() => (input.focus(), input.select()));
              const drawBtn = h('button', { class: 'btn draw-btn', type: 'button', onclick: () => (editing === sc ? exitDraw() : enterDraw(sc)) }, icon('pen'), h('span', { class: 'draw-btn-label' }));
              drawBtns.set(sc.id, drawBtn);
              queueMicrotask(() => markDrawBtn(sc));
              return h(
                'li',
                { class: 'shortcut-row' },
                h(
                  'button',
                  {
                    class: 'chip',
                    type: 'button',
                    title: 'Jump to this moment',
                    onclick: () => {
                      if (editing && editing !== sc) exitDraw();
                      video.pause();
                      video.currentTime = sc.time;
                      showDrawing(sc.drawing, sc.time);
                    },
                  },
                  fmtTime(sc.time),
                ),
                input,
                drawBtn,
                iconBtn('target', 'Move to current time', () => {
                  sc.time = video.currentTime;
                  if (editing === sc) shownAt = sc.time;
                  save();
                  renderShortcuts();
                }),
                iconBtn('trash', 'Delete shortcut', () => {
                  if (editing === sc) exitDraw();
                  slide.shortcuts = slide.shortcuts.filter((x) => x !== sc);
                  save();
                  renderShortcuts();
                  updateListItem(slide);
                }),
              );
            })
          : [h('li', { class: 'muted small empty-shortcuts' }, 'No shortcuts yet. Pause on a key moment, then tap “Add shortcut”, or “Draw on this frame” to mark it with arrows and rings.')]),
      );
    };
    renderShortcuts();

    const addShortcut = () => {
      if (editing) exitDraw();
      const sc: Shortcut = { id: uid(), title: `Moment ${slide.shortcuts.length + 1}`, time: video.currentTime };
      video.pause();
      slide.shortcuts.push(sc);
      save();
      renderShortcuts(sc.id);
      updateListItem(slide);
    };

    const titleIn = h('input', {
      class: 'input',
      type: 'text',
      value: slide.title,
      placeholder: 'e.g. Pressing trigger on their left back',
      oninput: () => {
        slide.title = titleIn.value;
        save();
        updateListItem(slide);
      },
    });
    const notesIn = h('textarea', {
      class: 'input',
      rows: 4,
      value: slide.notes,
      placeholder: 'Key points to make while showing this clip',
      oninput: () => {
        slide.notes = notesIn.value;
        save();
      },
    });
    const fpsNote = h('span', { class: 'muted small' }, slide.fps ? `${slide.fps} fps` : '');
    const playerTools = h(
      'div',
      { class: 'player-tools' },
      iconBtn('frameBack', 'Previous frame (,)', () => stepFrame(video, -1, slide.fps)),
      iconBtn('frameFwd', 'Next frame (.)', () => stepFrame(video, 1, slide.fps)),
      timeLabel,
      fpsNote,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', type: 'button', onclick: () => drawHere(), title: 'Draw on this frame (D). Saved as a shortcut.' }, icon('pen'), h('span', { class: 'label' }, 'Draw on this frame')),
      h('button', { class: 'btn accent', type: 'button', onclick: addShortcut, title: 'Add shortcut at current time (M)' }, icon('flag'), h('span', { class: 'label' }, 'Add shortcut')),
    );

    /** Draw on the current frame: reuses a shortcut already at this moment, or adds one. */
    function drawHere() {
      if (!video.getAttribute('src')) return toast('This slide has no playable clip');
      const t = video.currentTime;
      let sc = slide.shortcuts.find((x) => Math.abs(x.time - t) < 0.06);
      if (!sc) {
        sc = { id: uid(), title: `Moment ${slide.shortcuts.length + 1}`, time: t };
        slide.shortcuts.push(sc);
        save();
        renderShortcuts();
        updateListItem(slide);
      }
      enterDraw(sc);
    }
    const move = async (delta: number) => {
      await moveSlide(session, slide.id, delta);
      slides = await getSlides(session);
      renderList();
      refreshMoveBtns();
    };
    const upBtn = iconBtn('up', 'Move clip earlier', () => move(-1));
    const downBtn = iconBtn('down', 'Move clip later', () => move(1));
    refreshMoveBtns = () => {
      const i = slides.indexOf(slide);
      upBtn.disabled = i <= 0;
      downBtn.disabled = i < 0 || i >= slides.length - 1;
    };
    refreshMoveBtns();

    detailEl.append(
      player,
      playerTools,
      drawTools,
      h(
        'div',
        { class: 'fields' },
        h('label', { class: 'field' }, h('span', null, 'Title'), titleIn),
        h('label', { class: 'field' }, h('span', null, 'Comments'), notesIn),
        h('div', { class: 'field' }, h('span', null, 'Shortcuts'), shortcutList),
      ),
      h(
        'div',
        { class: 'slide-actions' },
        upBtn,
        downBtn,
        h('button', { class: 'btn', type: 'button', onclick: () => startPresenting(session.id, selectedIndex()) }, icon('present'), 'Present from here'),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn danger-text',
            type: 'button',
            onclick: async () => {
              if (!(await confirmDialog('Delete slide?', `“${slide.title || 'Untitled clip'}” and its clip will be removed.`, 'Delete', true))) return;
              const i = slides.indexOf(slide);
              save.cancel();
              await deleteSlide(session, slide.id);
              slides = await getSlides(session);
              selectedId = slides[Math.min(i, slides.length - 1)]?.id ?? null;
              renderList();
              renderDetail();
            },
          },
          icon('trash'),
          'Delete slide',
        ),
      ),
    );

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (editing) {
        // In draw mode only drawing keys apply; Esc or Enter finishes.
        if (bar.handleKey(e)) e.preventDefault();
        else if (e.key === 'Escape' || e.key === 'Enter') {
          e.preventDefault();
          exitDraw();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ',') stepFrame(video, -1, slide.fps);
      else if (e.key === '.') stepFrame(video, 1, slide.fps);
      else if (e.key === 'm' || e.key === 'M') addShortcut();
      else if (e.key === 'd' || e.key === 'D') drawHere();
      else if (e.key === ' ' && document.activeElement !== video) {
        e.preventDefault();
        video.paused ? video.play() : video.pause();
      } else return;
    };
    document.addEventListener('keydown', onKey);

    return () => {
      save.flush();
      bar.destroy();
      ann.destroy();
      stopFps();
      document.removeEventListener('keydown', onKey);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (url) URL.revokeObjectURL(url);
    };
  }

  renderList();
  renderDetail();

  return () => {
    saveTitle.flush();
    cleanupDetail();
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
    stopSortable();
  };
}
