// Offline: the installed app opens without a connection, and auto-ring (detector
// and pose model) keeps working once it has been used online.
import { expect, test, type Page } from '@playwright/test';
import { PHOTOS, tapPicture, waitForShapes, waitForVideo } from './helpers';

test.describe.configure({ timeout: 180_000 });

async function openDrawMode(page: Page) {
  await waitForVideo(page, '.editor-video');
  await page.locator('.draw-btn').first().click();
  await expect(page.locator('.draw-tools')).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator('.draw-tools [data-tool="auto"]').click();
}

test('app and auto-ring work offline after first use', async ({ page, context }) => {
  const photo = PHOTOS.closeUps; // close players, so the pose model is used too
  await page.goto('/'); // with the service worker
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await page.getByRole('button', { name: 'New session' }).first().click();
  await page.locator('dialog input').fill('Offline');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.locator('input[type=file]').setInputFiles([photo.clip]);
  await expect(page.locator('dialog')).toHaveCount(0, { timeout: 30_000 });
  await waitForVideo(page, '.editor-video');
  await page.getByRole('button', { name: 'Add shortcut' }).click();
  await page.keyboard.press('Enter');
  await openDrawMode(page);
  const s = (await page.evaluate(() => document.querySelector<HTMLVideoElement>('.editor-video')!.videoWidth)) / photo.width;
  const tapPlayer = (i: number) => {
    const [x1, y1, x2, y2] = photo.players[i];
    return tapPicture(page, '.editor-video', ((x1 + x2) / 2) * s, (y1 + 0.35 * (y2 - y1)) * s);
  };

  await tapPlayer(2);
  expect((await waitForShapes(page, 1))[0].p).toHaveLength(5);
  expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([expect.stringMatching(/^ta-detector-/)]));

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.draw-btn')).toHaveCount(1, { timeout: 15_000 });
  await openDrawMode(page);
  await tapPlayer(1);
  expect((await waitForShapes(page, 2))[1].p).toHaveLength(5);
});
