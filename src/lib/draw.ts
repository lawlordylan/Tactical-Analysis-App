// Drawing on video (telestration).
//
// An Annotator lays a <canvas> exactly over a <video> inside a positioned
// container ("stage"). Shapes are stored in coordinates normalised to the
// video picture itself (0..1 across the frame, ignoring letterbox bars), so a
// drawing lines up with the same players on any screen size or device.
import type { DrawShape, DrawTool } from './types';

export type { DrawShape, DrawTool };

/** Tools the user can pick. 'auto' rings the player under a tap (see detect.ts). */
export type Tool = DrawTool | 'auto';
/** Resolves to circle points [cx, cy, rx, ry] or, for a feet ring, [cx, cy, rx, ry, beamHeight]; null if no player. */
export type AutoRing = (nx: number, ny: number) => Promise<number[] | null>;

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

/** Per-shape draw-on animation progress, 0..1 (null = fully drawn). */
export type ShapeFx = (index: number) => number | null;

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
let scratch: HTMLCanvasElement | null = null;

/** Clip to a wedge that opens from the front of the ring, so the ring "draws itself on". */
function sweepClip(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, t: number) {
  if (t >= 1) return;
  const span = Math.PI * easeOut(t);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.ellipse(cx, cy, rx * 1.8 + 8, ry * 1.8 + 8, 0, Math.PI / 2 - span, Math.PI / 2 + span);
  ctx.closePath();
  ctx.clip();
}

/**
 * Soft column of light rising from a floor ring. Drawn onto the "light" layer,
 * which is screen-blended over the video so it brightens the player like light.
 */
function paintBeam(light: CanvasRenderingContext2D, cx: number, cy: number, rx: number, height: number, color: string, t: number) {
  const e = easeOut(t);
  if (e <= 0) return;
  const w = Math.ceil(rx * 2.1), h = Math.ceil(height * e);
  if (w < 2 || h < 2) return;
  scratch ??= document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const l = scratch.getContext('2d')!;
  const a = 0.42 * e;
  const v = l.createLinearGradient(0, h, 0, 0);
  v.addColorStop(0, rgba(color, a));
  v.addColorStop(0.45, rgba(color, a * 0.38));
  v.addColorStop(1, rgba(color, 0));
  l.fillStyle = v;
  l.fillRect(0, 0, w, h);
  l.globalCompositeOperation = 'destination-in';
  const hz = l.createLinearGradient(0, 0, w, 0);
  hz.addColorStop(0, 'rgba(0,0,0,0)');
  hz.addColorStop(0.28, 'rgba(0,0,0,1)');
  hz.addColorStop(0.72, 'rgba(0,0,0,1)');
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  l.fillStyle = hz;
  l.fillRect(0, 0, w, h);
  light.drawImage(scratch, cx - w / 2, cy - h);
}

/**
 * Draws shapes onto a 2D context whose picture area is `r` (in context pixels).
 * `light`, if given, receives light effects (the auto-ring beam).
 */
export function paint(ctx: CanvasRenderingContext2D, shapes: DrawShape[], r: Rect, fx?: ShapeFx, light?: CanvasRenderingContext2D) {
  for (let si = 0; si < shapes.length; si++) {
    const s = shapes[si];
    const anim = fx?.(si) ?? 1;
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
      const beam = s.g && s.p[4] ? s.p[4] * r.h : 0;
      if (s.g && beam) {
        // Auto-ring on a player's feet: a light beam rising through them, and a
        // ring painted on the pitch (bright at the front, fading at the back).
        if (light) paintBeam(light, cx, cy, rx, beam, s.c, (anim - 0.25) / 0.75);
        sweepClip(ctx, cx, cy, rx, ry, anim);
        const t = lw * 1.5;
        const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
        g.addColorStop(0, rgba(s.c, 0.4));
        g.addColorStop(0.5, rgba(s.c, 0.75));
        g.addColorStop(1, rgba(s.c, 1));
        ctx.shadowColor = 'rgba(0, 0, 0, .35)';
        ctx.shadowBlur = lw;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.ellipse(cx, cy, Math.max(1, rx - t), Math.max(1, ry - t * 0.55), 0, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = rgba(s.c, 0.14);
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx - t), Math.max(1, ry - t * 0.55), 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.g) {
        // Auto-ring on a close-up player: a crisp oval with a dark keyline.
        sweepClip(ctx, cx, cy, rx, ry, anim);
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = lw + 4;
        ctx.strokeStyle = 'rgba(0, 0, 0, .45)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = lw;
        ctx.strokeStyle = s.c;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.save();
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = rgba(s.c, 0.16);
        ctx.fill();
        ctx.restore();
        ctx.stroke();
      }
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
    .map((s) => ({ t: s.t, c: s.c, w: s.w === 2 ? 2 : 1, ...(s.d ? { d: true } : {}), ...(s.g && s.t === 'circle' ? { g: true } : {}), p: s.p }));
}

export class Annotator {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Screen-blended layer under the drawing, for light effects. */
  private light: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private shapes: DrawShape[] = [];
  private history: DrawShape[][] = [];
  private draft: DrawShape | null = null;
  private pointerId: number | null = null;
  private start: [number, number] = [0, 0];
  private ro: ResizeObserver;
  private dpr = 1;
  tool: Tool | null = null;
  /** Finds the player at a tapped point, for the 'auto' tool. */
  autoRing?: AutoRing;
  /** Called when auto-ring couldn't find a player (or failed) and a plain ring was placed instead. */
  onAutoMiss?: (reason: 'none' | 'error', err?: unknown) => void;
  private pending: { x: number; y: number; raf: number } | null = null;
  /** Rings animating in: shape index -> start time. */
  private pops = new Map<number, number>();
  private popRaf = 0;
  /** Bumped whenever the shown drawing is replaced, so a slow auto-ring can't land on the wrong one. */
  private gen = 0;
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
    this.light = document.createElement('canvas');
    this.light.className = 'draw-light';
    this.light.setAttribute('aria-hidden', 'true');
    this.lightCtx = this.light.getContext('2d')!;
    stage.append(this.light, this.canvas);
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
    this.canvas.width = this.light.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = this.light.height = Math.max(1, Math.round(r.height * this.dpr));
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
    this.lightCtx.clearRect(0, 0, this.light.width, this.light.height);
    const list = this.draft ? [...this.shapes, this.draft] : this.shapes;
    const r = this.rect();
    if (list.length) paint(ctx, list, r, this.pops.size ? (i) => this.popFx(i) : undefined, this.lightCtx);
    if (this.pending) {
      // "Looking…" indicator: a spinning dashed ring at the tap.
      const rad = Math.max(10, r.h * 0.03);
      ctx.save();
      ctx.strokeStyle = this.style.color;
      ctx.lineWidth = Math.max(2, r.h * 0.005);
      ctx.setLineDash([rad * 0.5, rad * 0.4]);
      ctx.lineDashOffset = -performance.now() / 30;
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(r.x + this.pending.x * r.w, r.y + this.pending.y * r.h, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Auto-rings draw themselves on: the ring sweeps round from the front, then the beam rises. */
  private popIn(indices: number[]) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const now = performance.now();
    for (const i of indices) this.pops.set(i, now);
    cancelAnimationFrame(this.popRaf);
    const tick = () => {
      this.render();
      if (this.pops.size) this.popRaf = requestAnimationFrame(tick);
    };
    this.popRaf = requestAnimationFrame(tick);
  }

  private popFx(i: number): number | null {
    const start = this.pops.get(i);
    if (start === undefined) return null;
    const t = (performance.now() - start) / 700;
    if (t >= 1) {
      this.pops.delete(i);
      return null;
    }
    return t;
  }

  get busy() {
    return !!this.pending;
  }

  private async runAuto(x: number, y: number, base: Omit<DrawShape, 't' | 'p'>) {
    const spin = () => {
      if (!this.pending) return;
      this.render();
      this.pending.raf = requestAnimationFrame(spin);
    };
    const gen = this.gen;
    this.pending = { x, y, raf: 0 };
    spin();
    let ring: number[] | null = null;
    let failed: unknown = null;
    try {
      ring = this.autoRing ? await this.autoRing(x, y) : null;
    } catch (e) {
      failed = e ?? new Error('Auto-ring failed');
    }
    if (gen !== this.gen) return;
    if (this.pending) cancelAnimationFrame(this.pending.raf);
    this.pending = null;
    const p = ring ? ring.map(round) : [x, y, 0.035, 0.02];
    this.commit([...this.shapes, { t: 'circle', ...base, ...(ring ? { g: true } : {}), p }]);
    if (ring) this.popIn([this.shapes.length - 1]);
    if (!ring) this.onAutoMiss?.(failed ? 'error' : 'none', failed);
  }

  getShapes(): DrawShape[] {
    return this.shapes.map((s) => ({ ...s, p: [...s.p] }));
  }

  /** Replace what's shown. Not undoable; use for loading a saved drawing. */
  setShapes(shapes: DrawShape[] | undefined) {
    this.cancelDraft();
    this.gen++;
    if (this.pending) cancelAnimationFrame(this.pending.raf);
    this.pending = null;
    this.shapes = (shapes ?? []).map((s) => ({ ...s, p: [...s.p] }));
    this.history = [];
    this.pops.clear();
    const glows = this.shapes.flatMap((s, i) => (s.g ? [i] : []));
    if (glows.length) this.popIn(glows);
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
    this.pops.clear();
    this.shapes = prev;
    this.render();
    this.onChange?.(this.getShapes());
  }

  clear() {
    if (!this.shapes.length) return;
    this.commit([]);
  }

  setTool(tool: Tool | null) {
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
    if (!this.tool || this.pointerId !== null || e.button > 0 || this.pending) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.onStroke?.();
    const [x, y] = this.toNorm(e);
    this.start = [x, y];
    const base = { c: this.style.color, w: (this.style.thick ? 2 : 1) as 1 | 2, ...(this.style.dashed && this.tool !== 'pen' ? { d: true } : {}) };
    if (this.tool === 'pen') this.draft = { t: 'pen', ...base, p: [x, y] };
    else if (this.tool === 'circle' || this.tool === 'auto') this.draft = { t: 'circle', ...base, p: [x, y, 0, 0] };
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
      const tapped = d.p[2] < 0.006 && d.p[3] < 0.006;
      if (tapped && this.tool === 'auto') {
        // Tap with auto-ring: find the player. (Dragging still sizes a ring by hand.)
        const { t: _t, p: _p, ...base } = d;
        this.render();
        void this.runAuto(d.p[0], d.p[1], base);
        return;
      }
      // A tap with the circle tool drops a standard-size player ring.
      if (tapped) {
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
    this.light.remove();
    cancelAnimationFrame(this.popRaf);
    this.pops.clear();
    if (this.pending) cancelAnimationFrame(this.pending.raf);
    this.pending = null;
    this.ro.disconnect();
    this.video.removeEventListener('loadedmetadata', this.resizeBound);
    this.canvas.remove();
  }
}
