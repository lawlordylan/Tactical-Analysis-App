// Auto-ring: tap a player and a ring snaps to them. Includes an accuracy check on
// real match photos with hand-marked players, so detection tuning can't quietly regress.
import { expect, test, type Page } from './test';
import { PHOTOS, createSession, ink, tapPicture, waitForShapes, waitForVideo, type MatchPhoto } from './helpers';

test.describe.configure({ timeout: 240_000 });

async function startAutoRing(page: Page, photo: MatchPhoto, title: string) {
  await createSession(page, title, [photo.clip]);
  await waitForVideo(page, '.editor-video');
  await page.getByRole('button', { name: 'Draw on this frame' }).click();
  await expect(page.locator('.draw-tools')).toBeVisible();
  await page.waitForTimeout(800);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('r');
  await expect(page.locator('.draw-tools [data-tool="auto"].on')).toHaveCount(1);
  return page.evaluate(() => document.querySelector<HTMLVideoElement>('.editor-video')!.videoWidth / 1);
}

test('editor: rings the tapped player, falls back to a plain ring on empty grass, drag still sizes by hand', async ({ page }) => {
  const photo = PHOTOS.wideGoalmouth;
  const vw = await startAutoRing(page, photo, 'Auto ring');
  const s = vw / photo.width;

  const targets = [photo.players[3], photo.players[5], photo.players[7], photo.players[2]]; // near player, distant player, referee, diving keeper
  for (const [i, [x1, y1, x2, y2]] of targets.entries()) {
    await tapPicture(page, '.editor-video', ((x1 + x2) / 2) * s, (y1 + 0.35 * (y2 - y1)) * s);
    const shapes = await waitForShapes(page, i + 1);
    const [cx, cy] = shapes[i].p;
    const W = photo.width, H = photo.height;
    expect(shapes[i]).toMatchObject({ t: 'circle', g: true });
    expect(shapes[i].p).toHaveLength(5); // floor ring with light beam
    expect(cx * W).toBeGreaterThanOrEqual(x1);
    expect(cx * W).toBeLessThanOrEqual(x2);
    expect(Math.abs(cy * H - y2) / (y2 - y1)).toBeLessThan(0.1); // at their feet
  }

  await tapPicture(page, '.editor-video', 960 * s, 1150 * s); // empty grass
  await expect(page.locator('.toast')).toContainText('No player found', { timeout: 15_000 });
  const afterMiss = await waitForShapes(page, 5);
  expect(afterMiss[4].g).toBeFalsy();

  const b = (await page.locator('.player .draw-layer').boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.38, b.y + b.height * 0.9, { steps: 8 });
  await page.mouse.up();
  await waitForShapes(page, 6);
});

test('present mode: auto-ring from the tool rail on a very wide shot', async ({ page }) => {
  const photo = PHOTOS.veryWide;
  await createSession(page, 'Auto ring present', [photo.clip]);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await waitForVideo(page, '.present-video');
  await page.locator('.tool-rail [data-tool="auto"]').click();
  const s = (await page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.videoWidth)) / photo.width;
  const before = await ink(page, '.stage .draw-layer');
  for (const [x1, y1, x2, y2] of [photo.players[1], photo.players[5], photo.players[7]]) {
    await tapPicture(page, '.present-video', ((x1 + x2) / 2) * s, (y1 + 0.3 * (y2 - y1)) * s);
    await page.waitForTimeout(1500);
  }
  expect(await ink(page, '.stage .draw-layer')).toBeGreaterThan(before + 300);
});

// Accuracy on hand-marked players. Thresholds sit a little below measured results
// (Oct 2026: every chest tap rang the right player; floor rings within ~4% of the
// feet except where players overlap), so real regressions fail but noise doesn't.
const ACCURACY: Record<keyof typeof PHOTOS, { rightPlayer: number; feetWithin: number; feetShare: number }> = {
  wideGoalmouth: { rightPlayer: 1, feetWithin: 0.08, feetShare: 0.85 },
  veryWide: { rightPlayer: 0.85, feetWithin: 0.1, feetShare: 0.85 },
  closeUps: { rightPlayer: 1, feetWithin: 0.15, feetShare: 0.8 },
  crowdedCorner: { rightPlayer: 0.85, feetWithin: 0.15, feetShare: 0.6 },
  celebration: { rightPlayer: 0.8, feetWithin: 0.15, feetShare: 0.75 },
};

for (const [name, photo] of Object.entries(PHOTOS) as [keyof typeof PHOTOS, MatchPhoto][]) {
  test(`accuracy: ${name} (${photo.players.length} players)`, async ({ page }, testInfo) => {
    const vw = await startAutoRing(page, photo, `Accuracy ${name}`);
    const s = vw / photo.width;
    const rows: string[] = [];
    let right = 0, rings = 0, feetOk = 0, scored = 0;
    for (const [i, [x1, y1, x2, y2]] of photo.players.entries()) {
      const hidden = photo.hidden?.includes(i);
      await tapPicture(page, '.editor-video', ((x1 + x2) / 2) * s, (y1 + 0.35 * (y2 - y1)) * s);
      const shape = (await waitForShapes(page, i + 1))[i];
      const [cx, cy] = shape.p;
      const px = cx * photo.width, py = cy * photo.height, h = y2 - y1;
      const isRight = !!shape.g && px >= x1 - (x2 - x1) * 0.05 && px <= x2 + (x2 - x1) * 0.05;
      if (!hidden) (right += +isRight), scored++;
      let detail = shape.g ? 'oval' : 'missed (plain ring)';
      if (shape.p.length === 5) {
        const err = (py - y2) / h;
        if (!hidden) {
          rings++;
          if (Math.abs(err) <= ACCURACY[name].feetWithin) feetOk++;
        }
        detail = `floor ring, ${(err * 100).toFixed(0)}% of height from feet`;
      }
      rows.push(`player ${i + 1}: ${isRight ? 'right player' : 'WRONG PLAYER'}, ${detail}${hidden ? ' (mostly hidden; not scored)' : ''}`);
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    await page.locator('.player').screenshot({ path: testInfo.outputPath(`${name}.png`) });
    await testInfo.attach('results', { body: rows.join('\n'), contentType: 'text/plain' });
    console.log(`\n${name}\n  ${rows.join('\n  ')}`);

    const n = scored;
    expect(right / n, `right player for ${right} of ${n}`).toBeGreaterThanOrEqual(ACCURACY[name].rightPlayer);
    if (rings) expect(feetOk / rings, `${feetOk} of ${rings} floor rings near the feet`).toBeGreaterThanOrEqual(ACCURACY[name].feetShare);
  });
}
