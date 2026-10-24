// Shared helpers for the browser tests.
import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const clip = (name: string) => join(here, 'fixtures', name);

/** Synthetic clips: 12 s at 25 fps, and 8 s at 30 fps. */
export const COUNTER_PRESS = clip('counter-press.webm');
export const BUILD_UP = clip('build-up.webm');

// '?nosw' turns the service worker off, so tests always run the fresh build.
export const APP = '/?nosw';

export interface Shape {
  t: string;
  c: string;
  w: number;
  d?: boolean;
  g?: boolean;
  p: number[];
}

/** Creates a session from the sessions screen and adds clips to it. */
export async function createSession(page: Page, title: string, clips: string[]) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'New session' }).first().click();
  await page.locator('dialog input').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.title-input')).toHaveValue(title);
  await page.locator('input[type=file]').setInputFiles(clips);
  await expect(page.locator('.slide-item')).toHaveCount(clips.length, { timeout: 30_000 });
  await expect(page.locator('dialog')).toHaveCount(0, { timeout: 30_000 });
}

export async function waitForVideo(page: Page, selector: string) {
  await expect(page.locator(selector)).toHaveCount(1);
  await page.waitForFunction((sel) => {
    const v = document.querySelector<HTMLVideoElement>(sel);
    return !!v && !!v.getAttribute('src') && v.readyState >= 2;
  }, selector, { timeout: 20_000 });
}

export async function seek(page: Page, selector: string, t: number) {
  await page.evaluate(([sel, t]) => {
    const v = document.querySelector<HTMLVideoElement>(sel as string)!;
    v.pause();
    v.currentTime = t as number;
  }, [selector, t] as const);
  await page.waitForFunction(([sel, t]) => Math.abs(document.querySelector<HTMLVideoElement>(sel as string)!.currentTime - (t as number)) < 0.02, [selector, t] as const);
}

export const currentTime = (page: Page, selector: string) =>
  page.evaluate((sel) => document.querySelector<HTMLVideoElement>(sel)!.currentTime, selector);

/** Page coordinates of a point given in video-picture pixels (the video uses object-fit: contain). */
export async function pictureToPage(page: Page, selector: string, px: number, py: number) {
  return page.evaluate(([sel, px, py]) => {
    const v = document.querySelector<HTMLVideoElement>(sel as string)!;
    const r = v.getBoundingClientRect();
    const s = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    return { x: r.left + (r.width - v.videoWidth * s) / 2 + (px as number) * s, y: r.top + (r.height - v.videoHeight * s) / 2 + (py as number) * s };
  }, [selector, px, py] as const);
}

export async function tapPicture(page: Page, selector: string, px: number, py: number) {
  const { x, y } = await pictureToPage(page, selector, px, py);
  await page.mouse.click(x, y);
}

/** Drag across an element, with positions as fractions of its box. */
export async function dragIn(page: Page, selector: string, from: [number, number], to: [number, number], steps = 12) {
  const b = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps });
  await page.mouse.up();
}

/** Number of visibly inked pixels on a canvas. */
export const ink = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector<HTMLCanvasElement>(sel)!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  }, selector);

/** Drawing saved on the first shortcut of the first slide that has shortcuts. */
export const savedShapes = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Shape[]>((resolve) => {
        const q = indexedDB.open('tactical-analysis');
        q.onsuccess = () => {
          q.result.transaction('slides').objectStore('slides').getAll().onsuccess = (e) => {
            const slides = (e.target as IDBRequest).result as { shortcuts: { drawing?: Shape[] }[] }[];
            resolve(slides.find((s) => s.shortcuts.length)?.shortcuts[0].drawing ?? []);
          };
        };
      }),
  );

export async function waitForShapes(page: Page, n: number, timeout = 30_000): Promise<Shape[]> {
  let shapes: Shape[] = [];
  await expect
    .poll(async () => (shapes = await savedShapes(page)).length, { timeout, intervals: [150] })
    .toBeGreaterThanOrEqual(n);
  return shapes;
}

/** Slide titles in session order, as stored. */
export const storedOrder = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const q = indexedDB.open('tactical-analysis');
        q.onsuccess = () => {
          const tx = q.result.transaction(['sessions', 'slides']);
          tx.objectStore('sessions').getAll().onsuccess = (e) => {
            const s = (e.target as IDBRequest).result[0];
            tx.objectStore('slides').getAll().onsuccess = (e2) => {
              const by = Object.fromEntries(((e2.target as IDBRequest).result as { id: string; title: string }[]).map((x) => [x.id, x.title]));
              resolve(s.slideIds.map((id: string) => by[id]));
            };
          };
        };
      }),
  );

/** Number of video files in the browser's private file system. */
export const storedVideoCount = (page: Page) =>
  page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    let n = 0;
    for await (const _ of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) n++;
    return n;
  });

// ---------- Real match photos with hand-marked players ----------
// Openly licensed photos (see fixtures/CREDITS.md), turned into short clips 1600 px wide.
// Player boxes are [x1, y1, x2, y2] in the original 1920 px-wide photo.
const K = 1920 / 1100; // some boxes were marked on 1100 px previews
const k = (b: number[]) => b.map((v) => v * K);

export interface MatchPhoto {
  clip: string;
  /** Original photo size. */
  width: number;
  height: number;
  players: number[][];
  /** Players almost entirely hidden behind someone else: a chest tap lands on the other player, so they're reported but not scored. */
  hidden?: number[];
}

export const PHOTOS: Record<string, MatchPhoto> = {
  wideGoalmouth: {
    clip: clip('match-00.webm'),
    width: 1920,
    height: 1280,
    players: [
      [140, 580, 278, 835], [370, 600, 505, 832], [678, 700, 885, 803], [1140, 585, 1228, 835], [1245, 605, 1368, 792],
      [1570, 595, 1630, 785], [1672, 580, 1742, 798], [1765, 590, 1838, 757], [1858, 595, 1920, 835],
    ],
  },
  veryWide: {
    clip: clip('match-06.webm'),
    width: 1920,
    height: 1280,
    players: [[10, 437, 58, 588], [137, 440, 210, 570], [235, 447, 288, 540], [608, 452, 640, 524], [650, 455, 672, 556], [665, 450, 725, 612], [960, 455, 1025, 555], [1015, 465, 1090, 628]].map(k),
  },
  crowdedCorner: {
    clip: clip('match-04.webm'),
    width: 1920,
    height: 1280,
    players: [[15, 200, 160, 595], [140, 205, 375, 715], [270, 235, 415, 590], [370, 235, 530, 585], [510, 220, 720, 665], [560, 105, 700, 520], [680, 130, 800, 560], [760, 145, 975, 600], [930, 225, 1065, 605]].map(k),
  },
  closeUps: {
    clip: clip('match-03.webm'),
    width: 1920,
    height: 1080,
    players: [[0, 115, 105, 515], [180, 145, 320, 510], [470, 110, 620, 555], [565, 110, 615, 490], [915, 95, 1025, 455], [985, 120, 1100, 560]].map(k),
    hidden: [3], // stands right behind #13
  },
  celebration: {
    clip: clip('match-01.webm'),
    width: 1920,
    height: 1280,
    players: [[340, 10, 440, 228], [208, 0, 268, 135], [458, 50, 560, 410], [520, 100, 700, 580], [625, 120, 750, 590], [150, 380, 345, 733]].map(k),
  },
};
