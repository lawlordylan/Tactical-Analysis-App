// Drawing on video (telestration).
//
// An Annotator lays a <canvas> exactly over a <video> inside a positioned
// container ("stage"). Shapes are stored in coordinates normalised to the
// video picture itself (0..1 across the frame, ignoring letterbox bars), so a
// drawing lines up with the same players on any screen size or device.
import type { DrawShape, DrawTool } from './types';

export type { DrawShape, DrawTool };

export const COLORS = [
  { value: '#ffffff', name: 'White' },
  { value: '#ffd43b', name: 'Yellow' },
  { value: '#ff4d4d', name: 'Red' },
  { value: '#3ccf5e', name: 'Green' },
  { value: '#4dc3ff', name: 'Blue' },
];

export interface DrawStyle {
  color: string;
  thick: boolean;
  dashed: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number) => Math.min(1.02, Math.max(-0.02, n));

/** Where the picture actually sits inside the video element (object-fit: contain). */
function pictureRect(video: HTMLVideoElement, boxW: number, boxH: number, offX: number, offY: number): Rect {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.min(boxW / vw, boxH / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: offX + (boxW - w) / 2, y: offY + (boxH - h) / 2, w, h };
}

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Draws shapes onto a 2D context whose picture area is `r` (in context pixels). */
export function paint(ctx: CanvasRenderingContext2D, shapes: DrawShape[], r: Rect) {
  for (const s of shapes) {
    const lw = Math.max(2, r.h * (s.w === 2 ? 0.011 : 0.0065));
    const X = (i: number) => r.x + s.p[i] * r.w;
    const Y = (i: number) => r.y + s.p[i + 1] * r.h;
    ctx.save();
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    // A soft dark halo keeps lines readable on bright grass and white kits.
    ctx.shadowColor = 'rgba(0, 0, 0, .55)';
    ctx.shadowBlur = lw * 1.4;
    if (s.d) ctx.setLineDash([lw * 2.2, lw * 2]);

    if (s.t === 'pen') {
      const n = s.p.length / 2;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      if (n === 1) ctx.lineTo(X(0) + 0.1, Y(0));
      for (let i = 1; i < n - 1; i++) {
        const mx = (X(i * 2) + X(i * 2 + 2)) / 2;
        const my = (Y(i * 2) + Y(i * 2 + 2)) / 2;
        ctx.quadraticCurveTo(X(i * 2), Y(i * 2), mx, my);
      }
      if (n > 1) ctx.lineTo(X((n - 1) * 2), Y((n - 1) * 2));
      ctx.stroke();
    } else if (s.t === 'line' || s.t === 'arrow') {
      const x1 = X(0), y1 = Y(0), x2 = X(2), y2 = Y(2);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const head = Math.min(lw * 4.2, len * 0.6);
      const ex = s.t === 'arrow' ? x2 - Math.cos(ang) * head * 0.8 : x2;
      const ey = s.t === 'arrow' ? y2 - Math.sin(ang) * head * 0.8 : y2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (s.t === 'arrow') {
        ctx.setLineDash([]);
        const spread = 0.42;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - Math.cos(ang - spread) * head, y2 - Math.sin(ang - spread) * head);
        ctx.lineTo(x2 - Math.cos(ang + spread) * head, y2 - Math.sin(ang + spread) * head);
        ctx.closePath();
        ctx.lineWidth = lw * 0.5;
        ctx.fill();
        ctx.stroke();
      }
    } else if (s.t === 'circle') {
      const cx = X(0), cy = Y(0);
      const rx = Math.max(1, Math.abs(s.p[2] * r.w));
      const ry = Math.max(1, Math.abs(s.p[3] * r.h));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = rgba(s.c, 0.16);
      ctx.fill();
      ctx.restore();
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Basic validation for shapes read from storage or an imported file. */
export function sanitizeShapes(input: unknown): DrawShape[] {
  if (!Array.isArray(input)) return [];
  const tools: DrawTool[] = ['pen', 'line', 'arrow', 'circle'];
  return input
    .filter(
      (s): s is DrawShape =>
        !!s &&
        tools.includes((s as DrawShape).t) &&
        typeof (s as DrawShape).c === 'string' &&
        /^#[0-9a-f]{6}$/i.test((s as DrawShape).c) &&
        Array.isArray((s as DrawShape).p) &&
        (s as DrawShape).p.length >= 2 &&
        (s as DrawShape).p.every((n) => typeof n === 'number' && isFinite(n)),
    )
    .map((s) => ({ t: s.t, c: s.c, w: s.w === 2 ? 2 : 1, ...(s.d ? { d: true } : {}), p: s.p }));
}

export class Annotator {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shapes: DrawShape[] = [];
  private history: DrawShape[][] = [];
  private draft: DrawShape | null = null;
  private pointerId: number | null = null;
  private start: [number, number] = [0, 0];
  private ro: ResizeObserver;
  private dpr = 1;
  tool: DrawTool | null = null;
  style: DrawStyle = { color: COLORS[0].value, thick: false, dashed: false };
  /** Called after every change made by drawing, undo or clear. */
  onChange?: (shapes: DrawShape[]) => void;
  /** Called when the user starts a stroke (e.g. to pause the video). */
  onStroke?: () => void;

  constructor(
    private stage: HTMLElement,
    private video: HTMLVideoElement,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'draw-layer';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d')!;
    stage.append(this.canvas);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(stage);
    video.addEventListener('loadedmetadata', this.resizeBound);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.cancel);
    this.resize();
  }

  private resizeBound = () => this.resize();

  private resize() {
    const r = this.stage.getBoundingClientRect();
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.render();
  }

  /** Picture rect in canvas pixels. */
  private rect(): Rect {
    const sr = this.stage.getBoundingClientRect();
    const vr = this.video.getBoundingClientRect();
    const r = pictureRect(this.video, vr.width, vr.height, vr.left - sr.left, vr.top - sr.top);
    return { x: r.x * this.dpr, y: r.y * this.dpr, w: r.w * this.dpr, h: r.h * this.dpr };
  }

  private toNorm(e: PointerEvent): [number, number] {
    const cr = this.canvas.getBoundingClientRect();
    const r = this.rect();
    const x = ((e.clientX - cr.left) * this.dpr - r.x) / r.w;
    const y = ((e.clientY - cr.top) * this.dpr - r.y) / r.h;
    return [round(clamp(x)), round(clamp(y))];
  }

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const list = this.draft ? [...this.shapes, this.draft] : this.shapes;
    if (list.length) paint(ctx, list, this.rect());
  }

  getShapes(): DrawShape[] {
    return this.shapes.map((s) => ({ ...s, p: [...s.p] }));
  }

  /** Replace what's shown. Not undoable; use for loading a saved drawing. */
  setShapes(shapes: DrawShape[] | undefined) {
    this.cancelDraft();
    this.shapes = (shapes ?? []).map((s) => ({ ...s, p: [...s.p] }));
    this.history = [];
    this.render();
  }

  get isEmpty() {
    return !this.shapes.length;
  }

  get canUndo() {
    return this.history.length > 0;
  }

  private commit(next: DrawShape[]) {
    this.history.push(this.shapes);
    if (this.history.length > 100) this.history.shift();
    this.shapes = next;
    this.render();
    this.onChange?.(this.getShapes());
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.shapes = prev;
    this.render();
    this.onChange?.(this.getShapes());
  }

  clear() {
    if (!this.shapes.length) return;
    this.commit([]);
  }

  setTool(tool: DrawTool | null) {
    this.tool = tool;
    this.canvas.classList.toggle('active', !!tool);
    if (!tool) this.cancelDraft();
  }

  private cancelDraft() {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) this.canvas.releasePointerCapture(this.pointerId);
    this.pointerId = null;
    this.draft = null;
  }

  private down = (e: PointerEvent) => {
    if (!this.tool || this.pointerId !== null || e.button > 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.onStroke?.();
    const [x, y] = this.toNorm(e);
    this.start = [x, y];
    const base = { c: this.style.color, w: (this.style.thick ? 2 : 1) as 1 | 2, ...(this.style.dashed && this.tool !== 'pen' ? { d: true } : {}) };
    if (this.tool === 'pen') this.draft = { t: 'pen', ...base, p: [x, y] };
    else if (this.tool === 'circle') this.draft = { t: 'circle', ...base, p: [x, y, 0, 0] };
    else this.draft = { t: this.tool, ...base, p: [x, y, x, y] };
    this.render();
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId || !this.draft) return;
    const d = this.draft;
    if (d.t === 'pen') {
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = this.toNorm(ev);
        const lx = d.p[d.p.length - 2], ly = d.p[d.p.length - 1];
        if (Math.hypot(x - lx, y - ly) > 0.003) d.p.push(x, y);
      }
    } else {
      const [x, y] = this.toNorm(e);
      if (d.t === 'circle') {
        d.p[2] = round(Math.abs(x - this.start[0]));
        d.p[3] = round(Math.abs(y - this.start[1]));
      } else {
        d.p[2] = x;
        d.p[3] = y;
      }
    }
    this.render();
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const d = this.draft;
    this.cancelDraft();
    if (!d) return;
    let keep = true;
    if (d.t === 'line' || d.t === 'arrow') keep = Math.hypot(d.p[2] - d.p[0], d.p[3] - d.p[1]) > 0.01;
    if (d.t === 'circle') {
      // A tap with the circle tool drops a standard-size player ring.
      if (d.p[2] < 0.006 && d.p[3] < 0.006) {
        d.p[2] = 0.035;
        d.p[3] = 0.02;
      }
    }
    if (keep) this.commit([...this.shapes, d]);
    else this.render();
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.cancelDraft();
    this.render();
  };

  destroy() {
    this.ro.disconnect();
    this.video.removeEventListener('loadedmetadata', this.resizeBound);
    this.canvas.remove();
  }
}
