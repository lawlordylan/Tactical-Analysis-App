// Core flows: prepare a session, present it, export it and import it on another device.
import { expect, test, type Page } from './test';
import { readFileSync } from 'node:fs';
import { crc32, readZip } from '../../src/lib/zip';
import { APP, BUILD_UP, COUNTER_PRESS, createSession, currentTime, seek, storedVideoCount, waitForVideo } from './helpers';

async function addShortcut(page: Page, t: number, title: string) {
  await seek(page, '.editor-video', t);
  await page.getByRole('button', { name: 'Add shortcut' }).click();
  await page.keyboard.type(title);
}

/** Session with two clips; slide 1 titled, commented, with two shortcuts. */
async function preparedSession(page: Page, title = 'vs Rovers – 2nd half') {
  await createSession(page, title, [COUNTER_PRESS, BUILD_UP]);
  await page.locator('.slide-item').first().click();
  await page.locator('.fields input').first().fill('Counter-press after losing the ball');
  await page.locator('.fields textarea').fill('Nearest three players collapse on the ball.\nWatch the 6 screen the pass inside.');
  await waitForVideo(page, '.editor-video');
  await addShortcut(page, 3, 'Trigger: bad touch');
  await addShortcut(page, 7.2, 'Ball won back');
  await expect(page.locator('.shortcut-row')).toHaveCount(2);
  await page.waitForTimeout(600); // autosave debounce
}

test('the home page shows the app version', async ({ page }) => {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  await page.goto(APP);
  await expect(page.locator('.topbar .version-badge')).toHaveText(`v${version}`);
  await expect(page.locator('.topbar .version-badge')).toBeVisible();
});

test('prepare a session: clips, title, comments, shortcuts, frame stepping, saved across reload', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByText('No sessions yet')).toBeVisible();
  await preparedSession(page);
  expect(await storedVideoCount(page)).toBe(2);

  // Frame step with '.' moves one frame at 25 fps.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const before = await currentTime(page, '.editor-video');
  await page.keyboard.press('.');
  await expect.poll(async () => (await currentTime(page, '.editor-video')) - before).toBeGreaterThan(0.02);
  expect((await currentTime(page, '.editor-video')) - before).toBeLessThan(0.07);

  await page.reload();
  await expect(page.locator('.shortcut-row')).toHaveCount(2);
  await expect(page.locator('.fields input').first()).toHaveValue('Counter-press after losing the ball');
  await expect(page.locator('.shortcut-row input').nth(1)).toHaveValue('Ball won back');
});

test('present mode: shortcuts, slow motion, frame step, side panel, next clip, exit', async ({ page }) => {
  await preparedSession(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.counter')).toHaveText('1 / 2');
  await expect(page.locator('.sc-btn')).toHaveCount(2);
  await waitForVideo(page, '.present-video');

  await page.keyboard.press('2');
  await expect.poll(() => currentTime(page, '.present-video')).toBeCloseTo(7.2, 1);
  await expect(page.locator('.sc-btn.active')).toContainText('Ball won back');

  await page.keyboard.press('s');
  expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.playbackRate)).toBe(0.5);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentTime(page, '.present-video')).toBeGreaterThan(7.22);
  expect(await currentTime(page, '.present-video')).toBeLessThan(7.3);

  // Nothing may sit on top of the clip.
  await expect(page.locator('.notes-body')).toContainText('Nearest three players');
  const overlaps = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const st = r('.stage');
    const hit = (o: DOMRect) => !(o.right <= st.left || o.left >= st.right || o.bottom <= st.top || o.top >= st.bottom);
    return ['.present-top', '.transport', '.present-side', '.tool-rail'].filter((s) => hit(r(s)));
  });
  expect(overlaps).toEqual([]);

  await page.keyboard.press('n');
  await expect(page.locator('.present-side')).toBeHidden();
  await page.keyboard.press('n');
  await expect(page.locator('.present-side')).toBeVisible();

  await page.keyboard.press('PageDown');
  await expect(page.locator('.counter')).toHaveText('2 / 2');
  await waitForVideo(page, '.present-video');
  expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.playbackRate)).toBe(0.5);
  await page.keyboard.press(' ');
  await expect.poll(() => page.evaluate(() => !document.querySelector<HTMLVideoElement>('.present-video')!.paused)).toBe(true);

  // Esc leaves fullscreen first (if any), then present mode, back on the same slide.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.locator('.present').count()) await page.keyboard.press('Escape');
  await expect(page.locator('.title-input')).toBeVisible();
  await expect(page.locator('.slide-item.selected .slide-num')).toHaveText('2');
});

test('export to a .analysis file and import it on another device', async ({ page, newDevice }, testInfo) => {
  await page.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await preparedSession(page);

  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Session ready')).toBeVisible({ timeout: 30_000 });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const file = testInfo.outputPath('session.analysis');
  await (await downloading).saveAs(file);

  // A valid ZIP: session.json first, both clips, every CRC correct.
  const zip = await readZip(new Blob([readFileSync(file)]));
  const names = [...zip.keys()];
  expect(names[0]).toBe('session.json');
  expect(names).toHaveLength(3);
  for (const entry of zip.values()) {
    const bytes = new Uint8Array(await (await entry.blob()).arrayBuffer());
    expect(bytes.length).toBe(entry.size);
    expect(crc32(bytes)).toBe(entry.crc);
  }
  const meta = JSON.parse(await zip.get('session.json')!.text());
  expect(meta.slides[0].shortcuts[1].title).toBe('Ball won back');

  // Another "device": a fresh browser profile on a phone-sized screen.
  const phone = await newDevice({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p2 = await phone.newPage();
  await p2.goto(APP);
  const importOnce = async () => {
    const chooser = p2.waitForEvent('filechooser');
    await p2.getByRole('button', { name: 'Import' }).click();
    await (await chooser).setFiles(file);
  };
  await importOnce();
  await expect(p2.locator('.title-input')).toHaveValue('vs Rovers – 2nd half', { timeout: 30_000 });
  await expect(p2.locator('.slide-item')).toHaveCount(2);
  await expect(p2.locator('.shortcut-row')).toHaveCount(2);
  await waitForVideo(p2, '.editor-video');

  // Importing again keeps both, renaming the second.
  await p2.goto(APP + '#/');
  await importOnce();
  await expect(p2.locator('.title-input')).toHaveValue('vs Rovers – 2nd half (2)', { timeout: 30_000 });
  await p2.goto(APP + '#/');
  await expect(p2.locator('.session-card')).toHaveCount(2);
  expect(await storedVideoCount(p2)).toBe(4);

  // Deleting a session removes its clips from storage too.
  await p2.locator('.session-card').first().getByRole('button', { name: 'Delete' }).click();
  await p2.locator('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(p2.locator('.session-card')).toHaveCount(1);
  expect(await storedVideoCount(p2)).toBe(2);
  await phone.close();
});
