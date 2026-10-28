// The browser tests' `test`: Playwright's, except that in WebKit each test gets a normal
// browser profile. Playwright's usual WebKit contexts behave like private windows, where
// WebKit won't store video files, so no clip could ever be added.
// Specs import { test, expect } from './test' instead of '@playwright/test'.
import { test as base, type Browser, type BrowserContext, type BrowserContextOptions } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export * from '@playwright/test';

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

interface Fixtures {
  /** Opens another "device" (a fresh browser profile), e.g. to import an exported session. */
  newDevice: (options?: BrowserContextOptions) => Promise<BrowserContext>;
}

export const test = base.extend<Fixtures>({
  context: async ({ context, browserName, playwright, headless, viewport, isMobile, hasTouch, deviceScaleFactor, userAgent, baseURL, storageState }, use) => {
    if (browserName !== 'webkit') return use(context);
    const dir = mkdtempSync(join(tmpdir(), 'pw-webkit-'));
    const persistent = await playwright.webkit.launchPersistentContext(dir, {
      headless,
      viewport,
      isMobile,
      hasTouch,
      deviceScaleFactor,
      userAgent,
      baseURL,
    });
    await seedLocalStorage(persistent, storageState as StorageState | undefined);
    await use(persistent);
    await persistent.close();
    rmSync(dir, { recursive: true, force: true });
  },

  newDevice: async ({ browser, browserName, playwright, headless, baseURL, storageState }, use) => {
    const opened: { ctx: BrowserContext; dir?: string }[] = [];
    await use(async (options = {}) => {
      if (browserName !== 'webkit') {
        // Contexts from the test's browser get the config's options (baseURL, storageState).
        const ctx = await (browser as Browser).newContext(options);
        opened.push({ ctx });
        return ctx;
      }
      const dir = mkdtempSync(join(tmpdir(), 'pw-webkit-'));
      const ctx = await playwright.webkit.launchPersistentContext(dir, { headless, baseURL, ...options } as never);
      await seedLocalStorage(ctx, storageState as StorageState | undefined);
      opened.push({ ctx, dir });
      return ctx;
    });
    for (const { ctx, dir } of opened) {
      await ctx.close().catch(() => {});
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  },
});

/** Persistent profiles can't take a storageState, so set its localStorage before each page loads. */
async function seedLocalStorage(ctx: BrowserContext, state: StorageState | undefined) {
  const origins = state?.origins ?? [];
  if (!origins.length) return;
  await ctx.addInitScript((origins: StorageState['origins']) => {
    for (const o of origins) {
      if (o.origin !== location.origin) continue;
      for (const { name, value } of o.localStorage) if (localStorage.getItem(name) === null) localStorage.setItem(name, value);
    }
  }, origins);
}
