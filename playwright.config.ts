// Browser tests: npm run test:e2e   (first time: npx playwright install chromium)
// Builds the app, serves dist/ on port 4173 and runs tests/e2e/*.spec.ts in Chromium.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Auto-ring tests are CPU heavy; a few workers is plenty.
  workers: process.env.CI ? 2 : 3,
  // On GitHub, failures also show as annotations on the run.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }], ...(process.env.CI ? [['github'] as ['github']] : [])],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1366, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    // Tests start with no sessions, which would open the first-visit tour; mark it seen.
    // tour.spec.ts clears this to test the tour itself.
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'tourSeen', value: '1' }] }] },
  },
  webServer: {
    command: 'node scripts/build.mjs && node scripts/serve.mjs 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
