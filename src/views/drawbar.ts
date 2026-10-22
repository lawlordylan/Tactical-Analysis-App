// Drawing toolbar shared by present mode (tool rail) and the editor.
import { h, icon } from '../lib/dom';
import { Annotator, COLORS, type DrawTool } from '../lib/draw';
import { isTyping } from '../lib/util';

const TOOLS: { tool: DrawTool; icon: string; label: string; key: string }[] = [
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
  { tool: 'circle', icon: 'circle', label: 'Ring a player', key: 'C' },
  { tool: 'pen', icon: 'pen', label: 'Freehand', key: 'P' },
];

// Remember the presenter's last choices for the rest of the visit.
const remembered = { color: COLORS[0].value, thick: false, dashed: false };

export interface DrawBar {
  el: HTMLElement;
  refresh(): void;
  setTool(tool: DrawTool | null): void;
  /** Handles drawing keyboard shortcuts. Returns true if the key was used. */
  handleKey(e: KeyboardEvent): boolean;
  destroy(): void;
}

export function drawBar(a: Annotator, opts: { cls?: string; onToolChange?: (tool: DrawTool | null) => void; extra?: HTMLElement[] } = {}): DrawBar {
  a.style = { ...remembered };

  const toolBtns = TOOLS.map((t) =>
    h(
      'button',
      {
        class: 'tool',
        type: 'button',
        title: `${t.label} (${t.key})`,
        'aria-label': t.label,
        'aria-pressed': 'false',
        'data-tool': t.tool,
        onclick: () => setTool(a.tool === t.tool ? null : t.tool),
      },
      icon(t.icon),
    ),
  );

  const swatch = h('span', { class: 'swatch' });
  const colorBtn = h('button', { class: 'tool', type: 'button', title: 'Colour', 'aria-label': 'Colour', 'aria-haspopup': 'true', onclick: () => togglePop() }, swatch);
  const dashBtn = h('button', { class: 'tool', type: 'button', title: 'Dashed line, e.g. a run (D)', 'aria-label': 'Dashed line', onclick: () => toggleDashed() });
  const weightBtn = h('button', { class: 'tool', type: 'button', title: 'Line weight', 'aria-label': 'Thick line', onclick: () => toggleThick() });
  const undoBtn = h('button', { class: 'tool', type: 'button', title: 'Undo (Z)', 'aria-label': 'Undo', onclick: () => (a.undo(), refresh()) }, icon('undo'));
  const clearBtn = h('button', { class: 'tool', type: 'button', title: 'Clear drawing (X)', 'aria-label': 'Clear drawing', onclick: () => (a.clear(), refresh()) }, icon('eraser'));

  const el = h(
    'div',
    { class: `drawbar ${opts.cls ?? ''}`, role: 'toolbar', 'aria-label': 'Drawing tools' },
    ...toolBtns,
    h('span', { class: 'tool-sep' }),
    colorBtn,
    dashBtn,
    weightBtn,
    h('span', { class: 'tool-sep' }),
    undoBtn,
    clearBtn,
    ...(opts.extra ?? []),
  );

  // Colour picker: a small popover positioned next to the colour button.
  let pop: HTMLElement | null = null;
  function closePop() {
    pop?.remove();
    pop = null;
    document.removeEventListener('pointerdown', onOutside, true);
  }
  function onOutside(e: Event) {
    if (pop && !pop.contains(e.target as Node) && e.target !== colorBtn && !colorBtn.contains(e.target as Node)) closePop();
  }
  function togglePop() {
    if (pop) return closePop();
    pop = h(
      'div',
      { class: 'tool-pop', role: 'menu' },
      ...COLORS.map((c) =>
        h(
          'button',
          {
            class: `swatch-btn${a.style.color === c.value ? ' on' : ''}`,
            type: 'button',
            title: c.name,
            'aria-label': c.name,
            style: { '--c': c.value },
            onclick: () => {
              a.style.color = remembered.color = c.value;
              closePop();
              refresh();
              if (!a.tool) setTool('arrow');
            },
          },
        ),
      ),
    );
    document.body.append(pop);
    const r = colorBtn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const vertical = el.getBoundingClientRect().height > el.getBoundingClientRect().width;
    let left = vertical ? r.right + 8 : r.left + r.width / 2 - pr.width / 2;
    let top = vertical ? r.top + r.height / 2 - pr.height / 2 : r.bottom + 8;
    if (top + pr.height > innerHeight - 8) top = r.top - pr.height - 8;
    left = Math.min(Math.max(8, left), innerWidth - pr.width - 8);
    top = Math.max(8, top);
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
    document.addEventListener('pointerdown', onOutside, true);
  }

  function toggleDashed() {
    a.style.dashed = remembered.dashed = !a.style.dashed;
    refresh();
  }
  function toggleThick() {
    a.style.thick = remembered.thick = !a.style.thick;
    refresh();
  }

  function setTool(tool: DrawTool | null) {
    a.setTool(tool);
    closePop();
    refresh();
    opts.onToolChange?.(tool);
  }

  function refresh() {
    for (const b of toolBtns) {
      const on = b.dataset.tool === a.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    swatch.style.background = a.style.color;
    dashBtn.replaceChildren(icon(a.style.dashed ? 'dashed' : 'solid'));
    dashBtn.classList.toggle('on', a.style.dashed);
    dashBtn.setAttribute('aria-pressed', String(a.style.dashed));
    weightBtn.replaceChildren(icon(a.style.thick ? 'thick' : 'thin'));
    weightBtn.setAttribute('aria-pressed', String(a.style.thick));
    undoBtn.disabled = !a.canUndo;
    clearBtn.disabled = a.isEmpty;
  }

  function handleKey(e: KeyboardEvent): boolean {
    if (isTyping(e)) return false;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      a.undo();
      refresh();
      return true;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const t = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (t) setTool(a.tool === t.tool ? null : t.tool);
    else if (k === 'd') toggleDashed();
    else if (k === 'z' || e.key === 'Backspace') (a.undo(), refresh());
    else if (k === 'x' || e.key === 'Delete') (a.clear(), refresh());
    else if (e.key === 'Escape' && (a.tool || pop)) setTool(null);
    else return false;
    return true;
  }

  refresh();
  return { el, refresh, setTool, handleKey, destroy: closePop };
}
