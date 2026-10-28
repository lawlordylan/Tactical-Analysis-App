// Video helpers: read duration + grab a thumbnail, detect frame rate, and explain
// why a clip won't play.
import { describeFormat, isHevc, readClipFormat } from './codec';
import type { VideoRef } from './types';
import { fmtBytes } from './util';

export interface ClipInfo {
  duration: number;
  thumb?: string;
  playable: boolean;
  /** The browser reported it can't play this clip (as opposed to just being slow to load it). */
  failed?: boolean;
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
    v.onerror = () => finish({ duration: 0, playable: false, failed: true });
    v.onloadedmetadata = () => {
      // Loaded but no picture: the browser can't decode the video track and would play the
      // sound only (e.g. Chrome without HEVC support).
      if (!v.videoWidth) return finish({ duration: isFinite(v.duration) ? v.duration : 0, playable: false, failed: true });
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

const MEDIA_ERRORS = ['', 'aborted', 'network error', "couldn't decode", 'format not supported'];

/** e.g. "Safari 18.1 on iPhone (iOS 18.1)", "Chrome 130 on Windows". */
export function browserLabel(ua = navigator.userAgent): string {
  const v = (re: RegExp) => ua.match(re)?.[1];
  const browsers: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/([\d]+)/, 'Edge'],
    [/CriOS\/([\d]+)/, 'Chrome'],
    [/FxiOS\/([\d]+)/, 'Firefox'],
    [/SamsungBrowser\/([\d]+)/, 'Samsung Internet'],
    [/Firefox\/([\d]+)/, 'Firefox'],
    [/Chrome\/([\d]+)/, 'Chrome'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  const hit = browsers.find(([re]) => re.test(ua));
  const browser = hit ? `${hit[1]} ${v(hit[0])}` : 'Unknown browser';
  const ios = v(/ OS (\d+(?:_\d+)*) like Mac/)?.replace(/_/g, '.');
  const device = /iPhone|iPod/.test(ua)
    ? `iPhone (iOS ${ios ?? '?'})`
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? `iPad${ios ? ` (iPadOS ${ios})` : ''}`
      : /Android/.test(ua)
        ? `Android ${v(/Android ([\d.]+)/) ?? ''}`.trim()
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'unknown device';
  return `${browser} on ${device}`;
}

/** Loaded, but with no picture: the browser can't decode the video track and plays only the sound. */
export const isSoundOnly = (video: HTMLVideoElement) => !video.error && video.readyState >= 1 && !video.videoWidth;

export const HEVC_ADVICE =
  'Re-export it as H.264 MP4 to play it everywhere. To film in H.264 on an iPhone: Settings → Camera → Formats → Most Compatible.';

/**
 * Why a clip won't play: a message for the user, plus a details line (error code,
 * format, size, storage, browser) to screenshot when asking for help.
 */
export async function playbackProblem(video: HTMLVideoElement, blob: Blob | null, ref: VideoRef | null): Promise<{ message: string; details: string }> {
  const format = blob ? await readClipFormat(blob) : null;
  const err = video.error;
  const message =
    format && isHevc(format)
      ? `This browser can't play HEVC (H.265) video, the format iPhones record in by default. ${HEVC_ADVICE}`
      : "This browser can't play this clip. Re-export it as H.264 MP4 and add it again.";
  const details = [
    err
      ? `Error ${err.code}${MEDIA_ERRORS[err.code] ? ` (${MEDIA_ERRORS[err.code]})` : ''}${err.message ? `: ${err.message}` : ''}`
      : isSoundOnly(video)
        ? "Sound only: the picture can't be decoded"
        : 'No error code',
    format && describeFormat(format),
    ref && `${fmtBytes(ref.size)} in ${ref.storage === 'opfs' ? 'file storage' : 'the database'}`,
    blob && ref && blob.size !== ref.size && `copy is ${fmtBytes(blob.size)}`,
    browserLabel(),
  ]
    .filter(Boolean)
    .join(' · ');
  return { message, details };
}
