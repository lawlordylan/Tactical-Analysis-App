// Clip picker in present mode: click the title (or press G) to see every clip and
// jump to one; ‹ › beside the title step through them. A popover under the title
// on larger screens, a bottom sheet on phones.
import { expect, test, type Page } from '@playwright/test';
import { BUILD_UP, COUNTER_PRESS, createSession, waitForVideo } from './helpers';

async function present(page: Page) {
  // Present mode asks for fullscreen; keep the window resizable for the phone checks.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
  await createSession(page, 'Picker', [COUNTER_PRESS, BUILD_UP, COUNTER_PRESS]);
  await page.locator('.topbar .btn.primary').click(); // Present
  await expect(page.locator('.counter')).toHaveText('1 / 3');
  await waitForVideo(page, '.present-video');
}

const menuBox = (page: Page) =>
  page.evaluate(async () => {
    const m = document.querySelector('.clip-menu')!;
    await Promise.all(m.getAnimations().map((a) => a.finished));
    const r = m.getBoundingClientRect();
    const b = document.querySelector('.clip-picker')!.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, vw: innerWidth, vh: innerHeight, titleBottom: b.bottom };
  });

const isPaused = (page: Page) => page.evaluate(() => document.querySelector<HTMLVideoElement>('.present-video')!.paused);

test('click the title to pick a clip; ‹ › step through clips', async ({ page }) => {
  await present(page);
  const menu = page.locator('.clip-menu');
  const rows = page.locator('.clip-row');

  await page.keyboard.press(' ');
  await expect.poll(() => isPaused(page)).toBe(false);

  await page.locator('.clip-picker').click();
  await expect(menu).toBeVisible();
  await expect(page.locator('.clip-picker')).toHaveAttribute('aria-expanded', 'true');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(rows.nth(0)).toBeFocused();
  await expect(rows.nth(0).locator('.clip-meta')).toHaveText('0:12');
  expect(await isPaused(page)).toBe(true);

  // Desktop: a popover just under the title, on screen.
  const box = await menuBox(page);
  expect(box.top).toBeGreaterThanOrEqual(box.titleBottom);
  expect(box.top - box.titleBottom).toBeLessThan(20);
  expect(box.bottom).toBeLessThanOrEqual(box.vh);
  expect(box.left).toBeGreaterThanOrEqual(0);

  const third = await rows.nth(2).locator('.clip-name').textContent();
  await rows.nth(2).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.counter')).toHaveText('3 / 3');
  await expect(page.locator('.present-title')).toHaveText(third!);
  await waitForVideo(page, '.present-video');

  // ‹ › beside the title.
  const [prev, next] = [page.locator('.clip-step').first(), page.locator('.clip-step').last()];
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(page.locator('.counter')).toHaveText('2 / 3');
  await prev.click();
  await expect(page.locator('.counter')).toHaveText('1 / 3');
  await expect(prev).toBeDisabled();
  await next.click();
  await expect(page.locator('.counter')).toHaveText('2 / 3');

  // Clicking outside closes it and stays on the same clip.
  await page.locator('.clip-picker').click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  const stage = (await page.locator('.stage').boundingBox())!;
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await expect(menu).toBeHidden();
  await expect(page.locator('.counter')).toHaveText('2 / 3');
  await expect(page.locator('.present')).toBeVisible();
});

test('keyboard: G opens the picker, arrows and Enter or a clip number pick, Esc closes', async ({ page }) => {
  await present(page);
  const menu = page.locator('.clip-menu');

  await page.keyboard.press('g');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.clip-row').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.locator('.counter')).toHaveText('2 / 3');

  // Digits pick a clip number instead of jumping to a shortcut.
  await page.keyboard.press('g');
  await page.keyboard.press('3');
  await expect(page.locator('.clip-row').nth(2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.counter')).toHaveText('3 / 3');

  // Other present-mode keys wait while the picker is open.
  await page.keyboard.press('g');
  await page.keyboard.press('n');
  await expect(page.locator('.present-side')).toBeVisible();

  // Esc closes the picker but stays in present mode; G toggles it too.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('.present')).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('g');
  await expect(menu).toBeHidden();
  await expect(page.locator('.counter')).toHaveText('3 / 3');

  // Space plays again once it's closed (focus isn't left on a button).
  await waitForVideo(page, '.present-video');
  await page.keyboard.press(' ');
  await expect.poll(() => isPaused(page)).toBe(false);

  await expect(page.locator('.help-panel dt', { hasText: /^G$/ })).toHaveCount(1);
});

test.describe('phones', () => {
  test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });

  test('the picker is a bottom sheet in portrait and landscape', async ({ page }) => {
    await present(page);
    const menu = page.locator('.clip-menu');

    await page.locator('.clip-picker').tap();
    await expect(menu).toBeVisible();
    let box = await menuBox(page);
    expect(Math.abs(box.bottom - box.vh)).toBeLessThan(1);
    expect(box.left).toBeLessThan(1);
    expect(Math.abs(box.width - box.vw)).toBeLessThan(1);
    await page.locator('.clip-row').nth(1).tap();
    await expect(menu).toBeHidden();
    await expect(page.locator('.counter')).toHaveText('2 / 3');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('.clip-picker').tap();
    await expect(menu).toBeVisible();
    box = await menuBox(page);
    expect(Math.abs(box.bottom - box.vh)).toBeLessThan(1);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(560);
    await page.locator('.clip-menu-close').tap();
    await expect(menu).toBeHidden();
    await expect(page.locator('.counter')).toHaveText('2 / 3');
  });
});
