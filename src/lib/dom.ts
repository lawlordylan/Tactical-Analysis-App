// Tiny DOM builder: h('button', { class: 'btn', onclick }, 'Label')
export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'textContent', 'innerHTML', 'multiple', 'muted', 'playsInline', 'autoplay', 'controls', 'loop', 'preload']);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v as Record<string, string>)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else (el.style as unknown as Record<string, string>)[sk] = sv;
        }
      }
      else if (PROPS.has(k)) (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]) {
  for (const c of children.flat(Infinity as 1) as Child[]) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

const ICONS: Record<string, string> = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 5v14L8 12z" fill="currentColor" stroke="none"/><path d="M6 5v14"/>',
  next: '<path d="M6 5v14l10-7z" fill="currentColor" stroke="none"/><path d="M18 5v14"/>',
  frameBack: '<path d="M14 7l-5 5 5 5"/><path d="M19 7v10"/>',
  frameFwd: '<path d="M10 7l5 5-5 5"/><path d="M5 7v10"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  notes: '<path d="M5 4h14v16H5z"/><path d="M9 9h6M9 13h6M9 17h3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  forward: '<path d="M9 5l7 7-7 7"/>',
  present: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><path d="M10 7.5v5l4-2.5z" fill="currentColor" stroke="none"/>',
  export: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 13v7h14v-7"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  auto: '<ellipse cx="12" cy="19" rx="8" ry="2.6"/><circle cx="12" cy="6" r="2.4"/><path d="M12 9v5.5M9 11.5h6M10 18.5l2-4 2 4"/><path d="M19.5 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>',
  pen: '<path d="M4 20l1.2-4.4L16.6 4.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8z"/><path d="M14.5 6.3l3.2 3.2"/>',
  line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/>',
  arrow: '<path d="M5 19L18 6"/><path d="M10 5.5h8.5V14" />',
  circle: '<ellipse cx="12" cy="13" rx="8.5" ry="5.5"/><path d="M12 4v4" stroke-dasharray="1.5 2"/>',
  dashed: '<path d="M4 20l2.5-2.5M9 15l2.5-2.5M14 10l2.5-2.5M19 5l1-1"/>',
  solid: '<path d="M4 20L20 4"/>',
  thin: '<path d="M4 12h16" stroke-width="1.6"/>',
  thick: '<path d="M4 12h16" stroke-width="4.5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  eraser: '<path d="M8.5 20H20"/><path d="M5.6 16.4l9.9-9.9a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L12 18H7.2z"/><path d="M10 11.5l4.5 4.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

/** Icon button with an accessible label (also used as tooltip). */
export function iconBtn(name: string, label: string, onclick: (e: MouseEvent) => void, cls = 'btn icon-btn'): HTMLButtonElement {
  return h('button', { class: cls, type: 'button', title: label, 'aria-label': label, onclick }, icon(name));
}
