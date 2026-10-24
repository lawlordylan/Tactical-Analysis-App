// Drag to reorder clips: mouse on desktop, real touch events on a phone.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { BUILD_UP, COUNTER_PRESS, PHOTOS, createSession, storedOrder } from './helpers';

const CLIPS = [PHOTOS.wideGoalmouth.clip, PHOTOS.veryWide.clip, COUNTER_PRESS, BUILD_UP];
const titles = (page: Page) => page.locator('.slide-item .slide-title').allInnerTexts();

test('mouse: drag a clip to a new position; click still selects; move buttons agree', async ({ page }) => {
  await createSession(page, 'Reorder desktop', CLIPS);
  expect(await titles(page)).toEqual(['match-00', 'match-06', 'counter-press', 'build-up']);

  const items = page.locator('.slide-list > li');
  const a = (await items.nth(0).boundingBox())!;
  const c = (await items.nth(2).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 20, { steps: 4 });
  await page.mouse.move(c.x + c.width / 2, c.y + c.height * 0.8, { steps: 12 });
  await page.mouse.up();
  const expected = ['match-06', 'counter-press', 'match-00', 'build-up'];
  await expect.poll(() => titles(page)).toEqual(expected);
  expect(await page.locator('.slide-item .slide-num').allInnerTexts()).toEqual(['1', '2', '3', '4']);

  await page.reload();
  await expect(page.locator('.slide-item')).toHaveCount(4);
  expect(await titles(page)).toEqual(expected);
  expect(await storedOrder(page)).toEqual(expected);

  await page.locator('.slide-item').nth(3).click();
  await expect(page.locator('.slide-item.selected .slide-title')).toHaveText('build-up');
  await expect(page.getByRole('button', { name: 'Move clip later' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move clip earlier' }).click();
  await expect.poll(async () => (await titles(page))[2]).toBe('build-up');
});

test.describe('touch', () => {
  test.use({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  async function touchDrag(page: Page, cdp: CDPSession, from: { x: number; y: number }, to: { x: number; y: number }, holdMs = 0, steps = 14) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    if (holdMs) await page.waitForTimeout(holdMs);
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] });
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  }

  test('drag by handle, swipe scrolls instead, press-and-hold drags with auto-scroll', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'uses Chrome DevTools touch events');
    await createSession(page, 'Reorder phone', CLIPS);
    const cdp = await page.context().newCDPSession(page);
    const rail = page.locator('.slide-rail');
    const li = (i: number) => page.locator('.slide-list > li').nth(i);

    await rail.evaluate((el) => (el.scrollLeft = 0));
    const h0 = (await li(0).locator('.drag-handle').boundingBox())!;
    const i1 = (await li(1).boundingBox())!;
    await touchDrag(page, cdp, { x: h0.x + h0.width / 2, y: h0.y + h0.height / 2 }, { x: i1.x + i1.width * 0.85, y: h0.y + h0.height / 2 });
    const afterHandle = ['match-06', 'match-00', 'counter-press', 'build-up'];
    expect(await titles(page)).toEqual(afterHandle);

    const i0 = (await li(0).boundingBox())!;
    await touchDrag(page, cdp, { x: i0.x + 40, y: i0.y + 60 }, { x: i0.x - 60, y: i0.y + 60 }, 0, 6);
    expect(await titles(page)).toEqual(afterHandle);

    await rail.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.waitForTimeout(300);
    const last = (await li(3).boundingBox())!;
    const y = last.y + last.height * 0.75;
    await touchDrag(page, cdp, { x: last.x + last.width * 0.4, y }, { x: 6, y }, 500, 40);
    await expect.poll(async () => (await titles(page))[0]).toBe('build-up');
    expect(await storedOrder(page)).toEqual(await titles(page));
  });
});
