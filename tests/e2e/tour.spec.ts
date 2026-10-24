// "How it works" tour: opens by itself on a first visit, can be skipped, never
// opens by itself again, and is always available from the home page.
import { expect, test, type Page } from '@playwright/test';
import { APP } from './helpers';

// Start as a brand-new visitor (the config marks the tour as seen for other tests).
test.use({ storageState: { cookies: [], origins: [] } });

const STEPS = 8;
const tour = (page: Page) => page.locator('dialog.tour');
const title = (page: Page) => tour(page).locator('h2');

/** Every visible control and the text of the step sit inside the screen. */
const offScreen = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = [];
    const d = document.querySelector('dialog.tour')!.getBoundingClientRect();
    if (d.left < -0.5 || d.top < -0.5 || d.right > innerWidth + 0.5 || d.bottom > innerHeight + 0.5) out.push('dialog');
    for (const el of document.querySelectorAll<HTMLElement>('dialog.tour button, dialog.tour .tour-art')) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) out.push(el.textContent || el.className);
    }
    const main = document.querySelector<HTMLElement>('.tour-main')!;
    if (main.scrollWidth > main.clientWidth + 1) out.push('text wider than the dialog');
    return out;
  });

test('first visit: the tour opens, walks through every step and does not open again', async ({ page }) => {
  await page.goto(APP);
  await expect(tour(page)).toBeVisible();
  await expect(title(page)).toHaveText('Welcome to Match Analysis');
  await expect(tour(page).locator('.tour-dots span')).toHaveCount(STEPS);
  await expect(page.getByRole('button', { name: 'Back' })).toBeHidden();

  const seen: string[] = [];
  const parts: string[] = [];
  for (let i = 0; i < STEPS; i++) {
    seen.push((await title(page).textContent())!);
    parts.push((await tour(page).locator('.tour-part').textContent())!);
    await expect(tour(page).locator('.tour-dots span.on')).toHaveCount(1);
    if (i < STEPS - 1) await tour(page).locator('.tour-foot .btn.primary').click();
  }
  expect(new Set(seen).size).toBe(STEPS);
  expect(parts).toContain('Prepare a session');
  expect(parts).toContain('Present a session');
  await expect(page.getByRole('button', { name: 'Skip tour' })).toBeHidden();

  await page.getByRole('button', { name: 'Back' }).click();
  await expect(title(page)).toHaveText(seen[STEPS - 2]);
  await page.keyboard.press('ArrowRight');
  await expect(title(page)).toHaveText(seen[STEPS - 1]);

  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No sessions yet')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('skip, Esc and reopening from the home page', async ({ page }) => {
  await page.goto(APP);
  await expect(tour(page)).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('No sessions yet')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);

  // From the top bar, starting at the beginning; arrow keys move, Esc closes.
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await expect(title(page)).toHaveText('Welcome to Match Analysis');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(tour(page).locator('.tour-dots span').nth(2)).toHaveClass('on');
  await page.keyboard.press('ArrowLeft');
  await expect(tour(page).locator('.tour-dots span').nth(1)).toHaveClass('on');
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);

  // From the empty sessions list.
  await page.getByRole('button', { name: 'New here? See how it works' }).click();
  await expect(tour(page)).toBeVisible();
  await page.getByRole('button', { name: 'Skip tour' }).click();

  // Someone who already has sessions isn't interrupted, even if the tour was never seen.
  await page.getByRole('button', { name: 'New session' }).first().click();
  await page.locator('dialog input').fill('Already using it');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.title-input')).toHaveValue('Already using it');
  await page.evaluate(() => localStorage.removeItem('tourSeen'));
  await page.goto(APP + '#/');
  await expect(page.locator('.session-card')).toHaveCount(1);
  await page.waitForTimeout(300);
  await expect(tour(page)).toHaveCount(0);
});

for (const [w, h] of [[360, 740], [390, 844], [740, 360], [844, 390], [1024, 768]] as const) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h }, isMobile: w < 1000, hasTouch: true, deviceScaleFactor: 2 });

    test('every step fits the screen; swipe moves between steps', async ({ page }, testInfo) => {
      await page.goto(APP);
      await expect(tour(page)).toBeVisible();
      const problems: string[] = [];
      for (let i = 0; i < STEPS; i++) {
        problems.push(...(await offScreen(page)).map((p) => `step ${i + 1}: ${p}`));
        await page.screenshot({ path: testInfo.outputPath(`tour-${w}x${h}-${i + 1}.png`) });
        if (i < STEPS - 1) await tour(page).locator('.tour-foot .btn.primary').tap();
      }
      expect(problems).toEqual([]);

      // Swipe right goes back a step.
      const box = (await tour(page).boundingBox())!;
      const y = box.y + box.height / 2;
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: string, x: number) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await touch('touchStart', box.x + 40);
      for (let x = 60; x <= 200; x += 20) await touch('touchMove', box.x + x);
      await touch('touchEnd', box.x + 200);
      await expect(tour(page).locator('.tour-dots span').nth(STEPS - 2)).toHaveClass('on');
    });
  });
}
