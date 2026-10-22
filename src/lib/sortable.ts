// Drag-to-reorder for a list, using pointer events so it works with mouse,
// touch and pen (HTML5 drag-and-drop doesn't work on touch screens).
//
// - Mouse: drag an item from anywhere on it (a short move first, so clicks still work).
// - Touch / pen: drag by the item's handle, or press and hold anywhere on the item.
// - Works for vertical and horizontal lists (picked from the list's flex direction),
//   and scrolls the list's scroll container when dragging near its edge.

export interface SortableOptions {
  /** Selector for the draggable items (direct children of the list). */
  item: string;
  /** Selector for a drag handle inside an item (touch drags start here immediately). */
  handle?: string;
  onMove(from: number, to: number): void;
}

const HOLD_MS = 380;
const MOUSE_SLOP = 6;

function scrollParent(el: HTMLElement, horizontal: boolean): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    const ov = horizontal ? s.overflowX : s.overflowY;
    if (/(auto|scroll)/.test(ov) && (horizontal ? p.scrollWidth > p.clientWidth : p.scrollHeight > p.clientHeight)) return p;
  }
  return null;
}

export function sortable(list: HTMLElement, opts: SortableOptions): () => void {
  let state: {
    id: number;
    el: HTMLElement;
    items: HTMLElement[];
    from: number;
    to: number;
    horizontal: boolean;
    start: number;
    startScroll: number;
    /** Positions of item starts and sizes, along the axis, in list coordinates. */
    pos: number[];
    size: number[];
    gap: number;
    scroller: HTMLElement | null;
    last: number;
    raf: number;
  } | null = null;
  let pending: { id: number; x: number; y: number; el: HTMLElement; timer: number; mouse: boolean } | null = null;
  let suppressClick = false;

  const items = () => [...list.querySelectorAll<HTMLElement>(`:scope > ${opts.item}`)];
  const axisPos = (e: { clientX: number; clientY: number }, horizontal: boolean) => (horizontal ? e.clientX : e.clientY);

  function begin(id: number, el: HTMLElement, x: number, y: number) {
    const all = items();
    const from = all.indexOf(el);
    if (from < 0) return;
    const horizontal = getComputedStyle(list).flexDirection.startsWith('row');
    const lr = list.getBoundingClientRect();
    const pos = all.map((it) => {
      const r = it.getBoundingClientRect();
      return horizontal ? r.left - lr.left : r.top - lr.top;
    });
    const size = all.map((it) => (horizontal ? it.getBoundingClientRect().width : it.getBoundingClientRect().height));
    const gap = all.length > 1 ? pos[1] - pos[0] - size[0] : 0;
    const scroller = scrollParent(list, horizontal);
    state = {
      id,
      el,
      items: all,
      from,
      to: from,
      horizontal,
      start: horizontal ? x : y,
      startScroll: horizontal ? lr.left : lr.top,
      pos,
      size,
      gap,
      scroller,
      last: horizontal ? x : y,
      raf: 0,
    };
    list.classList.add('sorting');
    el.classList.add('dragging');
    navigator.vibrate?.(10);
    try {
      list.setPointerCapture(id);
    } catch {
      /* pointer may already be gone */
    }
    const loop = () => {
      if (!state) return;
      autoScroll();
      update();
      state.raf = requestAnimationFrame(loop);
    };
    state.raf = requestAnimationFrame(loop);
  }

  function update() {
    if (!state) return;
    const s = state;
    const lr = list.getBoundingClientRect();
    const listStart = s.horizontal ? lr.left : lr.top;
    // How far the dragged item has moved, in list coordinates (accounts for scrolling).
    const delta = s.last - s.start - (listStart - s.startScroll);
    s.el.style.transform = s.horizontal ? `translateX(${delta}px)` : `translateY(${delta}px)`;
    const centre = s.pos[s.from] + delta + s.size[s.from] / 2;
    let to = 0;
    for (let i = 0; i < s.items.length; i++) {
      if (i === s.from) continue;
      if (centre > s.pos[i] + s.size[i] / 2) to++;
    }
    s.to = to;
    const shift = s.size[s.from] + s.gap;
    s.items.forEach((it, i) => {
      if (i === s.from) return;
      let d = 0;
      if (s.from < to && i > s.from && i <= to) d = -shift;
      if (s.from > to && i >= to && i < s.from) d = shift;
      it.style.transform = d ? (s.horizontal ? `translateX(${d}px)` : `translateY(${d}px)`) : '';
    });
  }

  function autoScroll() {
    const s = state;
    if (!s?.scroller) return;
    const r = s.scroller.getBoundingClientRect();
    const lo = s.horizontal ? r.left : r.top;
    const hi = s.horizontal ? r.right : r.bottom;
    const edge = 48;
    let v = 0;
    if (s.last < lo + edge) v = -Math.ceil((lo + edge - s.last) / 4);
    else if (s.last > hi - edge) v = Math.ceil((s.last - (hi - edge)) / 4);
    if (v) {
      if (s.horizontal) s.scroller.scrollLeft += v;
      else s.scroller.scrollTop += v;
    }
  }

  function finish(commit: boolean) {
    const s = state;
    state = null;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    list.classList.remove('sorting');
    s.el.classList.remove('dragging');
    for (const it of s.items) it.style.transform = '';
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    if (commit && s.to !== s.from) opts.onMove(s.from, s.to);
  }

  function clearPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  const onDown = (e: PointerEvent) => {
    if (state || e.button > 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>(opts.item);
    if (!el || el.parentElement !== list) return;
    const onHandle = !!(opts.handle && (e.target as HTMLElement).closest(opts.handle));
    if (e.pointerType !== 'mouse' && onHandle) {
      e.preventDefault();
      begin(e.pointerId, el, e.clientX, e.clientY);
      return;
    }
    clearPending();
    pending = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el,
      mouse: e.pointerType === 'mouse',
      timer: e.pointerType === 'mouse' ? 0 : window.setTimeout(() => {
        // Press and hold on touch.
        if (pending) {
          const p = pending;
          pending = null;
          begin(p.id, p.el, p.x, p.y);
        }
      }, HOLD_MS),
    };
  };

  const onMove = (e: PointerEvent) => {
    if (state && e.pointerId === state.id) {
      e.preventDefault();
      state.last = axisPos(e, state.horizontal);
      return;
    }
    if (pending && e.pointerId === pending.id) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (pending.mouse && moved > MOUSE_SLOP) {
        const p = pending;
        pending = null;
        begin(p.id, p.el, p.x, p.y);
        if (state) state.last = axisPos(e, state.horizontal);
      } else if (!pending.mouse && moved > 10) {
        clearPending(); // finger is scrolling, not holding
      }
    }
  };

  const onUp = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.id) clearPending();
    if (state && e.pointerId === state.id) finish(true);
  };
  const onCancel = (e: PointerEvent) => {
    if (pending && e.pointerId === pending.id) clearPending();
    if (state && e.pointerId === state.id) finish(false);
  };
  const onClick = (e: MouseEvent) => {
    if (suppressClick) {
      e.stopPropagation();
      e.preventDefault();
    }
  };
  // Stop the long-press context menu on touch while holding to drag.
  const onContext = (e: Event) => {
    if (pending || state) e.preventDefault();
  };
  const onTouchMove = (e: TouchEvent) => {
    if (state) e.preventDefault();
  };

  list.addEventListener('pointerdown', onDown);
  list.addEventListener('pointermove', onMove);
  list.addEventListener('pointerup', onUp);
  list.addEventListener('pointercancel', onCancel);
  list.addEventListener('click', onClick, true);
  list.addEventListener('contextmenu', onContext);
  list.addEventListener('touchmove', onTouchMove, { passive: false });
  return () => {
    clearPending();
    finish(false);
    list.removeEventListener('pointerdown', onDown);
    list.removeEventListener('pointermove', onMove);
    list.removeEventListener('pointerup', onUp);
    list.removeEventListener('pointercancel', onCancel);
    list.removeEventListener('click', onClick, true);
    list.removeEventListener('contextmenu', onContext);
    list.removeEventListener('touchmove', onTouchMove);
  };
}
