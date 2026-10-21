export interface Shortcut {
  id: string;
  title: string;
  /** Seconds from the start of the clip. */
  time: number;
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
    shortcuts: { title: string; time: number }[];
    duration?: number;
    fps?: number;
    thumb?: string;
    video: { path: string; name: string; type: string; size: number } | null;
  }[];
}
