export type DrawTool = 'pen' | 'line' | 'arrow' | 'circle';

/**
 * One drawn shape. Coordinates are normalised to the video picture (0..1),
 * flattened into `p`:
 *   pen    [x0, y0, x1, y1, ...]
 *   line   [x1, y1, x2, y2]      arrow: same, head at (x2, y2)
 *   circle [cx, cy, rx, ry]      an ellipse; rx/ry as fractions of width/height
 */
export interface DrawShape {
  t: DrawTool;
  /** Colour, #rrggbb. */
  c: string;
  /** Line weight: 1 normal, 2 thick. */
  w: 1 | 2;
  /** Dashed line (e.g. a player's run). */
  d?: boolean;
  /** Glowing highlight ring (made by auto-ring). */
  g?: boolean;
  p: number[];
}

export interface Shortcut {
  id: string;
  title: string;
  /** Seconds from the start of the clip. */
  time: number;
  /** Drawing shown when presenting this shortcut. */
  drawing?: DrawShape[];
}

export interface VideoRef {
  id: string;
  name: string;
  type: string;
  size: number;
  /** Where the bytes live: the browser's private file system, or IndexedDB as a fallback. */
  storage: 'opfs' | 'idb';
}

export interface Slide {
  id: string;
  sessionId: string;
  title: string;
  notes: string;
  video: VideoRef | null;
  shortcuts: Shortcut[];
  duration?: number;
  /** Frames per second, used for frame stepping. Detected during playback. */
  fps?: number;
  /** Small JPEG data URL for the slide list. */
  thumb?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  title: string;
  slideIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** session.json inside an exported .analysis file. */
export interface SessionManifest {
  format: 'tactical-analysis-session';
  version: 1;
  exportedAt: string;
  app: string;
  session: { title: string; createdAt: number; updatedAt: number };
  slides: {
    title: string;
    notes: string;
    shortcuts: { title: string; time: number; drawing?: DrawShape[] }[];
    duration?: number;
    fps?: number;
    thumb?: string;
    video: { path: string; name: string; type: string; size: number } | null;
  }[];
}
