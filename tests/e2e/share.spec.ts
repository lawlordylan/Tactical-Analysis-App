// Opening a share link (#/s/<id>): Google Drive is stood in for, so tests never touch the real Drive.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './test';
import { APP, BUILD_UP, COUNTER_PRESS, clip, storedVideoCount, waitForVideo } from './helpers';

const DRIVE = 'https://www.googleapis.com/drive/v3/files/';

/** Answers the app's Drive downloads with these files (by Drive file id); anything else is a 404. */
async function mockDrive(page: Page, files: Record<string, Buffer | object>) {
  await page.route(`${DRIVE}**`, (route) => {
    const url = new URL(route.request().url());
    const id = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
    const headers = { 'Access-Control-Allow-Origin': '*' };
    const file = files[id];
    if (!file) return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{"error":{"code":404,"message":"File not found"}}' });
    if (Buffer.isBuffer(file)) return route.fulfill({ status: 200, headers, contentType: 'application/octet-stream', body: file });
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(file) });
  });
}

const A = readFileSync(COUNTER_PRESS);
const B = readFileSync(BUILD_UP);
const ARROW = { t: 'arrow', c: '#ffffff', w: 1, p: [0.2, 0.6, 0.7, 0.4] };

function manifest(revision: number, title: string, clips: [string, string, Buffer][], sharedAt = '2026-11-20T18:00:00.000Z') {
  return {
    format: 'tactical-analysis-share',
    version: 1,
    revision,
    sharedAt,
    app: 'tactical-analysis-app test',
    session: { title, createdAt: 1, updatedAt: 2 },
    slides: clips.map(([id, name, bytes], i) => ({
      title: `Clip ${i + 1}`,
      notes: i === 0 ? 'Press together.' : '',
      shortcuts: i === 0 ? [{ title: 'Ball won back', time: 2, drawing: [ARROW] }] : [],
      duration: 8,
      video: { id, name, type: 'video/webm', size: bytes.length },
    })),
  };
}

test('open a share link: see the session, download it, and it opens like any other session', async ({ page }, testInfo) => {
  await mockDrive(page, { man1: manifest(1, 'vs Rovers – 2nd half', [['c1', 'counter-press.webm', A], ['c2', 'build-up.webm', B]]), c1: A, c2: B });
  await page.goto(`${APP}#/s/man1`);

  const card = page.locator('.shared-card');
  await expect(card.locator('.shared-title')).toHaveText('vs Rovers – 2nd half');
  await expect(card).toContainText('2 clips · 1 shortcut');
  await expect(card).toContainText(/Shared (20 Nov 2026|Nov 20, 2026)/);
  for (const [w, h] of [[390, 844], [844, 390], [1366, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.screenshot({ path: testInfo.outputPath(`share-card-${w}x${h}.png`), fullPage: true });
  }
  await card.getByRole('button', { name: 'Download to this device' }).click();

  // Lands in the downloaded session: both clips, the comment, the shortcut and its drawing.
  await expect(page.locator('.title-input')).toHaveValue('vs Rovers – 2nd half', { timeout: 30_000 });
  await expect(page.locator('.slide-item')).toHaveCount(2);
  await waitForVideo(page, '.editor-video');
  await expect(page.locator('.fields textarea')).toHaveValue('Press together.');
  await expect(page.locator('.shortcut-row input').first()).toHaveValue('Ball won back');
  await expect(page.locator('.draw-btn.has')).toHaveCount(1);
  expect(await storedVideoCount(page)).toBe(2);

  // Opening the link again: already here and up to date.
  await page.goto(`${APP}#/s/man1`);
  await expect(card).toContainText('already on this device and up to date');
  await card.getByRole('button', { name: 'Open session' }).click();
  await expect(page.locator('.title-input')).toHaveValue('vs Rovers – 2nd half');
});

test('a newer shared version replaces the old copy, which keeps its place', async ({ page }) => {
  const files: Record<string, Buffer | object> = { man1: manifest(1, 'Training', [['c1', 'a.webm', A], ['c2', 'b.webm', B]]), c1: A, c2: B };
  await mockDrive(page, files);
  await page.goto(`${APP}#/s/man1`);
  await page.getByRole('button', { name: 'Download to this device' }).click();
  await expect(page.locator('.slide-item')).toHaveCount(2, { timeout: 30_000 });
  const firstUrl = page.url();

  // The coach updates the shared copy: new title, one clip.
  files.man1 = manifest(2, 'Training (updated)', [['c3', 'b2.webm', B]], '2026-11-24T18:00:00.000Z');
  files.c3 = B;
  await page.goto(`${APP}#/s/man1`);
  const card = page.locator('.shared-card');
  await expect(card).toContainText(/A newer version was shared on (24 Nov 2026|Nov 24, 2026)/);
  await card.getByRole('button', { name: 'Update your copy' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Training (updated)', { timeout: 30_000 });
  await expect(page.locator('.slide-item')).toHaveCount(1);
  expect(page.url()).toBe(firstUrl); // same session, updated in place

  await page.goto(`${APP}#/`);
  await expect(page.locator('.session-card')).toHaveCount(1);
  expect(await storedVideoCount(page)).toBe(1); // the old clips were removed
});

test("a link that doesn't work any more says so", async ({ page }) => {
  await mockDrive(page, {});
  await page.goto(`${APP}#/s/missing123`);
  const card = page.locator('.shared-card');
  await expect(card).toContainText('Link not working');
  await expect(card).toContainText('may no longer be shared');
  await expect(card.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Your sessions' }).click();
  await expect(page.getByText('No sessions yet')).toBeVisible();
});

test('a download that fails part-way leaves nothing behind and can be retried', async ({ page, browserName }) => {
  const files: Record<string, Buffer | object> = { man1: manifest(1, 'Flaky', [['c1', 'a.webm', A], ['c2', 'b.webm', B]]), c1: A };
  await mockDrive(page, files);
  await page.goto(`${APP}#/s/man1`);
  await page.getByRole('button', { name: 'Download to this device' }).click();
  const card = page.locator('.shared-card');
  await expect(card).toContainText("Couldn't open the link", { timeout: 30_000 });
  await expect(card).toContainText('“b.webm” is missing');
  await expect(card.getByRole('button', { name: 'Try again' })).toBeVisible();

  // No session, and (where each test has its own storage) no stray clip files.
  await page.goto(`${APP}#/`);
  await expect(page.getByText('No sessions yet')).toBeVisible();
  if (browserName === 'chromium') {
    const files = await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos', { create: true });
      let n = 0;
      for await (const _ of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) n++;
      return n;
    });
    expect(files).toBe(0);
  }

  // The missing clip turns up: Try again works.
  files.c2 = B;
  await page.goto(`${APP}#/s/man1`);
  await page.getByRole('button', { name: 'Download to this device' }).click();
  await expect(page.locator('.slide-item')).toHaveCount(2, { timeout: 30_000 });
});

test("a shared clip this device can't play is flagged straight away", async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs a browser without HEVC support');
  const hevc = readFileSync(clip('hevc-hdr.mov'));
  await mockDrive(page, { man1: { ...manifest(1, 'iPhone clips', [['c1', 'hevc-hdr.mov', hevc]]) }, c1: hevc });
  await page.goto(`${APP}#/s/man1`);
  await page.getByRole('button', { name: 'Download to this device' }).click();
  const warning = page.locator('dialog[open]', { hasText: "This clip won't play here" });
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(warning).toContainText('HEVC (H.265)');
  await warning.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('.slide-item')).toHaveCount(1);
});
