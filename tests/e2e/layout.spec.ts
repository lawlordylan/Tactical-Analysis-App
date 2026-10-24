// Present mode must fit every screen: no control outside its bar, nothing off screen,
// and nothing on top of the clip. Small landscape phones have caught us out before.
import { expect, test } from '@playwright/test';
import { COUNTER_PRESS, createSession, waitForVideo } from './helpers';

const SIZES: [number, number][] = [
  [320, 640], [360, 740], [375, 667], [390, 844], [412, 915], // phones, portrait
  [640, 360], [667, 375], [740, 360], [844, 390], [915, 412], // phones, landscape
  [1024, 768], [1366, 820], // tablet, laptop
];

test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2, viewport: { width: 412, height: 915 } });

test('present mode fits phones, tablets and laptops in both orientations', async ({ page }, testInfo) => {
  // Present mode asks for fullscreen, and newer Chrome won't resize a fullscreen window.
  // This test is about layout at each size, so keep the window resizable.
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.resolve();
  });
  await createSession(page, 'Layout', [COUNTER_PRESS, COUNTER_PRESS]);
  await page.locator('.topbar .btn.primary').click(); // Present
  await expect(page.locator('.counter')).toHaveText('1 / 2');
  await waitForVideo(page, '.present-video');

  const problems: string[] = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const inside = (el: Element, box: Element) => {
        const r = el.getBoundingClientRect(), c = box.getBoundingClientRect();
        return r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
      };
      for (const el of document.querySelectorAll<HTMLElement>('.present button, .present input')) {
        if (!el.offsetParent || el.classList.contains('sc-btn')) continue;
        const box = el.closest('.transport, .present-top, .tool-rail, .side-section') ?? document.body;
        const r = el.getBoundingClientRect();
        const label = el.getAttribute('aria-label') || el.className;
        if (!inside(el, box)) out.push(`outside its bar: ${label}`);
        if (r.right > innerWidth + 0.5 || (r.bottom > innerHeight + 0.5 && !el.closest('.present-side, .tool-rail'))) out.push(`off screen: ${label}`);
      }
      const st = document.querySelector('.stage')!.getBoundingClientRect();
      for (const s of ['.present-top', '.transport', '.present-side', '.tool-rail']) {
        const o = document.querySelector(s)?.getBoundingClientRect();
        if (o && o.width && !(o.right <= st.left || o.left >= st.right || o.bottom <= st.top || o.top >= st.bottom)) out.push(`covers the clip: ${s}`);
      }
      return out;
    });
    problems.push(...found.map((f) => `${w}x${h} ${f}`));
    await page.screenshot({ path: testInfo.outputPath(`present-${w}x${h}.png`) });
  }
  expect(problems).toEqual([]);
});
