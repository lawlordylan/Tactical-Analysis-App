// Drawing on shortcuts: prepare in the editor, show when presenting, export with the session.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readZip } from '../../src/lib/zip';
import { APP, COUNTER_PRESS, createSession, dragIn, ink, savedShapes, seek, waitForShapes, waitForVideo } from './helpers';

const EDITOR_LAYER = '.player .draw-layer';
const STAGE_LAYER = '.stage .draw-layer';

async function sessionWithDrawing(page: import('@playwright/test').Page) {
  await createSession(page, 'Drawing test', [COUNTER_PRESS]);
  await waitForVideo(page, '.editor-video');
  await seek(page, '.editor-video', 5);
  await page.getByRole('button', { name: 'Draw on this frame' }).click();
  await expect(page.locator('.draw-tools')).toBeVisible();
  await expect(page.locator('.player.drawing')).toHaveCount(1);
  expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('.editor-video')!.controls)).toBe(false);
  await page.waitForTimeout(800); // the player scrolls into view

  // Drawing mode opens with the arrow tool ready.
  await expect(page.locator('.draw-tools [data-tool="arrow"].on')).toHaveCount(1);
  await dragIn(page, EDITOR_LAYER, [0.2, 0.7], [0.6, 0.35]);
  await page.locator('.draw-tools [aria-label="Colour"]').click();
  await page.locator('.tool-pop [aria-label="Yellow"]').click();
  await page.locator('.draw-tools [aria-label="Dashed line"]').click();
  await dragIn(page, EDITOR_LAYER, [0.65, 0.75], [0.85, 0.3]);
  await page.locator('.draw-tools [aria-label="Ring a player"]').click();
  await dragIn(page, EDITOR_LAYER, [0.3, 0.3], [0.36, 0.33]);
  await page.locator('.draw-tools [aria-label="Freehand"]').click();
  await dragIn(page, EDITOR_LAYER, [0.1, 0.2], [0.25, 0.15], 20);
  expect(await ink(page, EDITOR_LAYER)).toBeGreaterThan(2000);
  await page.locator('.draw-tools [aria-label="Undo"]').click(); // removes the freehand line
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.draw-tools')).toBeHidden();
  await expect(page.locator('.shortcut-row .draw-btn')).toContainText('Drawing · 3');
  await waitForShapes(page, 3);
}

test('draw on a shortcut in the editor; it is saved, survives reload and shows when jumping to it', async ({ page }) => {
  await sessionWithDrawing(page);
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.draw-btn.has')).toHaveCount(1);

  const shapes = await savedShapes(page);
  expect(shapes.map((s) => s.t)).toEqual(['arrow', 'arrow', 'circle']);
  expect(shapes[1]).toMatchObject({ d: true, c: '#ffd43b' });
  // Stored relative to the video picture, not the screen.
  expect(shapes[0].p[0]).toBeCloseTo(0.2, 1);

  await waitForVideo(page, '.editor-video');
  await page.locator('.shortcut-row .chip').first().click();
  await expect.poll(() => ink(page, EDITOR_LAYER)).toBeGreaterThan(1000);
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.editor-video')!.play());
  await expect.poll(() => ink(page, EDITOR_LAYER)).toBe(0);
});

test('present: saved drawing on shortcut jump, frame step keeps it, play clears it, live drawing', async ({ page }) => {
  await sessionWithDrawing(page);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.counter')).toHaveText('1 / 1');
  await waitForVideo(page, '.present-video');
  expect(await ink(page, STAGE_LAYER)).toBe(0);

  await page.keyboard.press('1');
  await expect.poll(() => ink(page, STAGE_LAYER)).toBeGreaterThan(1000);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  expect(await ink(page, STAGE_LAYER)).toBeGreaterThan(1000);
  await page.keyboard.press(' ');
  await expect.poll(() => ink(page, STAGE_LAYER)).toBe(0);

  // Live drawing pauses the clip; X clears, Z undoes, Esc puts the tool down (and stays in present mode).
  await page.keyboard.press('a');
  await expect(page.locator('.tool-rail [data-tool="arrow"].on')).toHaveCount(1);
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.play());
  await page.waitForTimeout(300);
  await dragIn(page, STAGE_LAYER, [0.3, 0.6], [0.7, 0.4]);
  expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.paused)).toBe(true);
  expect(await ink(page, STAGE_LAYER)).toBeGreaterThan(500);
  await page.keyboard.press('x');
  expect(await ink(page, STAGE_LAYER)).toBe(0);
  await page.keyboard.press('z');
  expect(await ink(page, STAGE_LAYER)).toBeGreaterThan(500);
  await page.keyboard.press('Escape');
  await expect(page.locator('.present')).toHaveCount(1);
  await expect(page.locator('.tool-rail .tool.on[data-tool]')).toHaveCount(0);
});

test('drawings travel with an exported session', async ({ page, browser }, testInfo) => {
  await page.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await sessionWithDrawing(page);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Session ready')).toBeVisible({ timeout: 30_000 });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const file = testInfo.outputPath('draw.analysis');
  await (await downloading).saveAs(file);
  const meta = JSON.parse(await (await readZip(new Blob([readFileSync(file)]))).get('session.json')!.text());
  expect(meta.slides[0].shortcuts[0].drawing).toHaveLength(3);

  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto(APP);
  const chooser = p2.waitForEvent('filechooser');
  await p2.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(file);
  await expect(p2.locator('.draw-btn.has')).toHaveCount(1, { timeout: 30_000 });
  await other.close();
});
