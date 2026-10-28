// Clips the browser can't play (e.g. iPhone HEVC), and clips the browser doesn't save properly.
import { expect, test } from './test';
import { APP, COUNTER_PRESS, clip, waitForVideo } from './helpers';

const HEVC = clip('hevc-hdr.mov');

async function newSession(page: import('@playwright/test').Page, title: string) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'New session' }).first().click();
  await page.locator('dialog input').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.title-input')).toHaveValue(title);
}

test("an HEVC clip this browser can't play: warned when added, and the player says why", async ({ page, browserName }) => {
  // Playwright's Chromium has no HEVC (or H.264) decoder; Safari plays HEVC, so there's nothing to warn about.
  test.skip(browserName !== 'chromium', 'needs a browser without HEVC support');
  await newSession(page, 'HEVC clip');
  await page.locator('input[type=file]').setInputFiles(HEVC);

  const warning = page.locator('dialog[open]', { hasText: "This clip won't play here" });
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(warning).toContainText('“hevc-hdr.mov” (HEVC (H.265), 10-bit HDR in a .mov file)');
  await expect(warning).toContainText('Settings → Camera → Formats → Most Compatible');
  await warning.getByRole('button', { name: 'OK' }).click();

  // The clip is kept (it can still play on an iPhone), and the player explains the problem.
  await expect(page.locator('.slide-item')).toHaveCount(1);
  const msg = page.locator('.player-msg');
  await expect(msg).toContainText("This browser can't play HEVC (H.265) video");
  await expect(msg.locator('.player-msg-details')).toContainText('HEVC (H.265), 10-bit HDR in a .mov file');
  // Chromium plays the sound but can't decode the picture, so there's no error code.
  await expect(msg.locator('.player-msg-details')).toContainText(/Error \d|Sound only/);

  // Present mode shows the same explanation.
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.present .player-msg')).toContainText("This browser can't play HEVC (H.265) video");
});

test("file storage that doesn't keep the clip: falls back to the database, and the clip still plays after reload", async ({ page }) => {
  // Make file-system writes report success but keep nothing (what WebKit on Windows does).
  await page.addInitScript(() => {
    if (typeof FileSystemFileHandle === 'undefined') return;
    FileSystemFileHandle.prototype.createWritable = async function () {
      return new WritableStream({ write() {} }) as unknown as FileSystemWritableFileStream;
    };
  });
  await newSession(page, 'Storage fallback');
  await page.locator('input[type=file]').setInputFiles(COUNTER_PRESS);
  await expect(page.locator('.slide-item')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('dialog[open]')).toHaveCount(0, { timeout: 30_000 });
  await waitForVideo(page, '.editor-video');

  const storage = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((res) => {
          const o = indexedDB.open('tactical-analysis');
          o.onsuccess = () => {
            const q = o.result.transaction('slides').objectStore('slides').getAll();
            q.onsuccess = () => res(q.result.map((s: { video: { storage: string } }) => s.video.storage));
          };
        }),
    );
  expect(await storage()).toEqual(['idb']);

  await page.reload();
  await waitForVideo(page, '.editor-video');
  await expect(page.locator('.player-msg')).toBeHidden();
});
