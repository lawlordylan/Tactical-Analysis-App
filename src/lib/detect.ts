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
//
// Where's the floor? For distant players the detector's box ends at their feet,
// so the ring goes at the bottom of the box. For bigger (closer) players the box
// is often cut short at the knees or waist, so a pose model (MediaPipe
// PoseLandmarker lite, ~5.8 MB, loaded on first need) finds their heels and toes.
// Only if their feet can't be seen does the ring become an oval round the player.
import type { NormalizedLandmark, ObjectDetector, PoseLandmarker } from '@mediapipe/tasks-vision';

const BASE = './detector/';
const MODEL = `${BASE}efficientdet_lite0_int8.tflite`;
const POSE_MODEL = `${BASE}pose_landmarker_lite.task`;

let loading: Promise<ObjectDetector> | null = null;
let poseLoading: Promise<PoseLandmarker> | null = null;
let filesetLoading: Promise<{ fileset: unknown; vision: typeof import('@mediapipe/tasks-vision') }> | null = null;

function runtime() {
  if (!filesetLoading) {
    filesetLoading = (async () => {
      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(`${BASE}wasm`);
      return { fileset, vision };
    })();
    filesetLoading.catch(() => (filesetLoading = null));
  }
  return filesetLoading;
}

function loadPose(): Promise<PoseLandmarker> {
  if (!poseLoading) {
    poseLoading = runtime().then(({ fileset, vision }) =>
      vision.PoseLandmarker.createFromOptions(fileset as never, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numPoses: 4,
        minPoseDetectionConfidence: 0.3,
        minPosePresenceConfidence: 0.3,
      }),
    );
    poseLoading.catch(() => (poseLoading = null));
  }
  return poseLoading;
}

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
      const { fileset, vision } = await runtime();
      const { ObjectDetector } = vision;
      // CPU on purpose: the int8 model is the smallest and fastest on CPU (~30 ms on a
      // Pixel 6), and MediaPipe's GPU delegate does not run int8 models correctly.
      return ObjectDetector.createFromOptions(fileset as never, {
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

interface Feet {
  /** Floor point under the player, video px. */
  x: number;
  y: number;
  /** Top of the head, video px. */
  top: number;
  /** Distance between the feet, video px. */
  stance: number;
}

// Pose landmark indices: nose..ears 0-10, shoulders 11/12, hips 23/24, ankles 27/28, heels 29/30, toes 31/32.
const HEAD = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const TORSO = [11, 12, 23, 24];
const FEET = [27, 28, 29, 30, 31, 32];

/**
 * Finds where the tapped player is standing, using a pose model on a crop around
 * their (possibly cut-short) detector box. Returns null if their feet aren't visible.
 */
async function findFeet(video: HTMLVideoElement, b: Box, tx: number, ty: number): Promise<Feet | 'no-feet' | null> {
  const pose = await loadPose();
  const W = video.videoWidth, H = video.videoHeight;
  // A tall, narrow crop centred on the tapped player, so they're the clear subject
  // (the pose model only reports the most prominent people), reaching well below
  // the box because a close player's box often stops at the knees or waist.
  const cw = Math.min(W, Math.max(b.w * 1.4, b.h * 0.7));
  const x = Math.min(Math.max(0, b.x + b.w / 2 - cw / 2), W - cw);
  const y = Math.max(0, b.y - b.h * 0.1);
  const ch = Math.min(H - y, b.h * 2.1);
  const s = Math.max(1, Math.max(cw, ch) / 512);
  canvas.width = Math.round(cw / s);
  canvas.height = Math.round(ch / s);
  ctx.drawImage(video, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
  const people = pose.detect(canvas).landmarks;
  const toPx = (l: NormalizedLandmark) => ({ x: x + l.x * cw, y: y + l.y * ch, v: l.visibility ?? 1 });

  // The person whose torso is nearest the tap (and inside the tapped player's box).
  let best: ReturnType<typeof toPx>[] | null = null;
  let bestD = Infinity;
  for (const lm of people) {
    const pts = lm.map(toPx);
    const torso = TORSO.map((i) => pts[i]);
    const cx = torso.reduce((a, p) => a + p.x, 0) / 4, cy = torso.reduce((a, p) => a + p.y, 0) / 4;
    // Must be this player, not a teammate beside them: torso within the middle of their box.
    if (cx < b.x + b.w * 0.1 || cx > b.x + b.w * 0.9 || cy < b.y || cy > b.y + b.h * 1.05) continue;
    const d = Math.hypot((cx - tx) / b.w, (cy - ty) / b.h);
    if (d < bestD) (best = pts), (bestD = d);
  }
  if (!best) return null;
  const feet = FEET.map((i) => best![i]).filter((p) => p.v > 0.5 && p.y < H * 0.985 && p.y > 0);
  if (feet.length < 2) return 'no-feet';
  const ankles = [best[27], best[28]].filter((p) => p.v > 0.5);
  const footY = Math.max(...feet.map((p) => p.y));
  const footX = (ankles.length ? ankles : feet).reduce((a, p) => a + p.x, 0) / (ankles.length || feet.length);
  const headY = Math.min(...HEAD.map((i) => best![i].y));
  const bodyH = footY - headY;
  return { x: footX, y: footY, top: headY - bodyH * 0.1, stance: Math.max(...feet.map((p) => p.x)) - Math.min(...feet.map((p) => p.x)) };
}

/**
 * Finds the player at (nx, ny), given in 0..1 picture coordinates.
 * Returns a ring as [cx, cy, rx, ry] in picture coordinates, or null if no one is there.
 */
export async function findPlayerRing(video: HTMLVideoElement, nx: number, ny: number): Promise<number[] | null> {
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
    // Cut off by the crop edge: re-centre on the player at a zoom that fits them,
    // repeating while they're still cut off (tall close-up players need a couple of goes).
    let cur = b, cx0 = x, cy0 = y, cs = side;
    for (let n = 0; n < 3 && isCut(cur, cx0, cy0, cs); n++) {
      [cx0, cy0, cs] = cropAt(cur.x + cur.w / 2, cur.y + cur.h / 2, Math.max(cs * 1.25, cur.h * 1.6, cur.w * 1.6), 0.5);
      const next = pick(detectIn(det, video, cx0, cy0, cs), tx, ty);
      if (!next) break;
      cur = next;
    }
    found = cur;
    break;
  }
  if (!found) found = pick(detectIn(det, video, 0, 0, W, H), tx, ty);
  if (!found) return null;

  const b = found;
  const ring = (cx: number, cy: number, rx: number, top: number) => [cx / W, cy / H, rx / W, (rx * 0.34) / H, (cy - top) / H];

  // Distant player: the box ends at their feet.
  if (b.h < H * 0.25) return ring(b.x + b.w / 2, b.y + b.h * 0.98, Math.max(b.w * 0.72, b.h * 0.34), b.y - b.h * 0.15);

  // Closer player: find their feet with the pose model.
  let feet: Feet | 'no-feet' | null = null;
  try {
    feet = await findFeet(video, b, tx, ty);
  } catch (e) {
    console.warn('Pose model unavailable', e);
  }
  if (feet && feet !== 'no-feet') {
    const bodyH = feet.y - feet.top;
    const rx = Math.min(Math.max(feet.stance * 0.75, bodyH * 0.28), bodyH * 0.4);
    return ring(feet.x, feet.y, rx, feet.top);
  }
  // Feet out of shot or hidden behind other players: an oval around the visible player instead.
  // (A close player's detector box often stops at the knees or waist, so its bottom edge isn't the floor.)
  return [(b.x + b.w / 2) / W, (b.y + b.h / 2) / H, (b.w * 0.62) / W, (b.h * 0.56) / H];
}
