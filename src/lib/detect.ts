// Auto-ring: find the player under a tap on a paused frame.
//
// Uses a small on-device person detector (MediaPipe ObjectDetector with
// EfficientDet-Lite0 int8, ~4.6 MB). Nothing leaves the device. The runtime and
// model are downloaded the first time the tool is used, then cached for offline use.
//
// Why "zoomed crop": the detector looks at a 320x320 picture, so in a wide shot
// a distant player is only a few pixels tall and gets missed. Because we know
// where the user tapped, we crop a region around the tap and detect in that,
// which makes distant players big enough to find. Testing on 38 players across
// wide, medium, close-up and crowded photos: chest taps 100%, off-centre taps
// 95%, feet taps 87% (vs 79-87% when detecting on the whole frame).
import type { ObjectDetector } from '@mediapipe/tasks-vision';

const BASE = './detector/';
const MODEL = `${BASE}efficientdet_lite0_int8.tflite`;

let loading: Promise<ObjectDetector> | null = null;

/** Box in video pixels. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function detectorLoaded(): boolean {
  return !!loading;
}

export function loadDetector(): Promise<ObjectDetector> {
  if (!loading) {
    loading = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
      // CPU on purpose: the int8 model is the smallest and fastest on CPU (~30 ms on a
      // Pixel 6), and MediaPipe's GPU delegate does not run int8 models correctly.
      return ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        scoreThreshold: 0.25,
        categoryAllowlist: ['person'],
        maxResults: 40,
      });
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

function detectIn(det: ObjectDetector, video: HTMLVideoElement, x: number, y: number, w: number, h = w): Box[] {
  // The detector works at 320px; up to 640px keeps detail without wasting time.
  const s = Math.max(1, Math.max(w, h) / 640);
  canvas.width = Math.round(w / s);
  canvas.height = Math.round(h / s);
  ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return det.detect(canvas).detections.flatMap((d) =>
    d.boundingBox ? [{ x: x + d.boundingBox.originX * s, y: y + d.boundingBox.originY * s, w: d.boundingBox.width * s, h: d.boundingBox.height * s }] : [],
  );
}

/** The detected person whose box best contains the tap. */
function pick(boxes: Box[], tx: number, ty: number): Box | null {
  let best: Box | null = null;
  let bestD = Infinity;
  for (const b of boxes) {
    const mx = b.w * 0.12, my = b.h * 0.08;
    if (tx < b.x - mx || tx > b.x + b.w + mx || ty < b.y - my || ty > b.y + b.h + my) continue;
    const d = Math.hypot((tx - (b.x + b.w / 2)) / b.w, (ty - (b.y + b.h * 0.45)) / b.h);
    if (d < bestD) (best = b), (bestD = d);
  }
  return best;
}

/**
 * Finds the player at (nx, ny), given in 0..1 picture coordinates.
 * Returns a ring as [cx, cy, rx, ry] in picture coordinates, or null if no one is there.
 */
export async function findPlayerRing(video: HTMLVideoElement, nx: number, ny: number): Promise<[number, number, number, number] | null> {
  const det = await loadDetector();
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) return null;
  const tx = nx * W, ty = ny * H;

  const cropAt = (cx: number, cy: number, size: number, frac: number) => {
    const side = Math.min(W, H, size);
    return [Math.min(Math.max(0, cx - side / 2), W - side), Math.min(Math.max(0, cy - side * frac), H - side), side] as const;
  };
  const isCut = (b: Box, x: number, y: number, side: number) => {
    const e = side * 0.01;
    return (b.y < y + e && y > 0) || (b.y + b.h > y + side - e && y + side < H) || (b.x < x + e && x > 0) || (b.x + b.w > x + side - e && x + side < W);
  };

  let found: Box | null = null;
  for (const k of [0.3, 0.6]) {
    const [x, y, side] = cropAt(tx, ty, k * H, 0.6);
    const b = pick(detectIn(det, video, x, y, side), tx, ty);
    if (!b) continue;
    if (b.h < 1.4 * b.w && k < 0.6) {
      // Squat box: may be just the legs of a close-up player. Check one zoom level out.
      const [x2, y2, s2] = cropAt(tx, ty, side * 2.2, 0.6);
      const b2 = pick(detectIn(det, video, x2, y2, s2), tx, ty);
      if (b2 && b2.h > b.h * 1.35) {
        found = b2;
        break;
      }
    }
    if (!isCut(b, x, y, side)) {
      found = b;
      break;
    }
    // Cut off by the crop edge: re-centre on the player at a zoom that fits them.
    const [x3, y3, s3] = cropAt(b.x + b.w / 2, b.y + b.h / 2, Math.max(side, b.h * 1.5, b.w * 1.5), 0.5);
    found = pick(detectIn(det, video, x3, y3, s3), tx, ty) ?? b;
    break;
  }
  if (!found) found = pick(detectIn(det, video, 0, 0, W, H), tx, ty);
  if (!found) return null;

  const b = found;
  if (b.h < H * 0.4) {
    // Distant player: a flat ring on the ground at their feet (broadcast style).
    const rx = Math.max(b.w * 0.72, b.h * 0.34);
    return [(b.x + b.w / 2) / W, (b.y + b.h * 0.98) / H, rx / W, (rx * 0.34) / H];
  }
  // Close-up: an oval around the whole player.
  return [(b.x + b.w / 2) / W, (b.y + b.h / 2) / H, (b.w * 0.62) / W, (b.h * 0.56) / H];
}
