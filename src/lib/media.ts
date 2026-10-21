// Video helpers: read duration + grab a thumbnail, and detect frame rate.

export interface ClipInfo {
  duration: number;
  thumb?: string;
  playable: boolean;
}

/** Load a clip off-screen, read its duration and capture a small JPEG thumbnail. */
export function probeClip(blob: Blob): Promise<ClipInfo> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let settled = false;
    const finish = (info: ClipInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(info);
    };
    const timer = setTimeout(() => finish({ duration: isFinite(v.duration) ? v.duration : 0, playable: v.readyState > 0 }), 8000);
    v.onerror = () => finish({ duration: 0, playable: false });
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(1, (v.duration || 0) / 3);
    };
    v.onseeked = () => {
      let thumb: string | undefined;
      try {
        const w = 320;
        const h = Math.round((w * (v.videoHeight || 9)) / (v.videoWidth || 16));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d')!.drawImage(v, 0, 0, w, h);
        thumb = c.toDataURL('image/jpeg', 0.7);
      } catch {
        /* thumbnail is optional */
      }
      finish({ duration: v.duration, thumb, playable: true });
    };
    v.src = url;
  });
}

const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120];

/**
 * Watches a playing video with requestVideoFrameCallback and reports the
 * frame rate once it has seen enough consecutive frames. Returns a stop fn.
 */
export function watchFps(video: HTMLVideoElement, onFps: (fps: number) => void): () => void {
  if (!('requestVideoFrameCallback' in video)) return () => {};
  let handle = 0;
  let lastMedia = -1;
  let lastFrames = -1;
  const deltas: number[] = [];
  let stopped = false;
  const cb = (_now: number, meta: VideoFrameCallbackMetadata) => {
    if (stopped) return;
    if (lastMedia >= 0 && video.playbackRate === 1 && meta.presentedFrames === lastFrames + 1) {
      const d = meta.mediaTime - lastMedia;
      if (d > 0.004 && d < 0.1) deltas.push(d);
    }
    lastMedia = meta.mediaTime;
    lastFrames = meta.presentedFrames;
    if (deltas.length >= 24) {
      const sorted = [...deltas].sort((a, b) => a - b);
      const raw = 1 / sorted[Math.floor(sorted.length / 2)];
      const best = COMMON_FPS.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a));
      onFps(Math.abs(best - raw) / raw < 0.03 ? best : Math.round(raw));
      stopped = true;
      return;
    }
    handle = video.requestVideoFrameCallback(cb);
  };
  handle = video.requestVideoFrameCallback(cb);
  return () => {
    stopped = true;
    video.cancelVideoFrameCallback(handle);
  };
}

/** Step one frame forward (+1) or back (-1). Pauses the video. */
export function stepFrame(video: HTMLVideoElement, dir: 1 | -1, fps = 25) {
  video.pause();
  const frame = Math.round(video.currentTime * fps);
  const target = (frame + dir) / fps + 0.25 / fps;
  video.currentTime = Math.min(Math.max(0, target), Math.max(0, (video.duration || 0) - 0.001));
}
