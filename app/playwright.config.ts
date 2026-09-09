import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env.CI);
const playwrightPort = Number(process.env.PLAYWRIGHT_PORT ?? 5177);
const playwrightOrigin = `http://127.0.0.1:${playwrightPort}`;

export default defineConfig({
  testDir: './e2e',
  outputDir: '../.artifacts/playwright-test/results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: ci ? 1 : 2,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../.artifacts/playwright-test/report', open: 'never' }],
  ],
  use: {
    baseURL: playwrightOrigin,
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${playwrightPort}`,
    url: playwrightOrigin,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      grepInvert: /@mobile/,
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-390',
      testMatch: '**/responsive.spec.ts',
      grep: /@mobile/,
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 } },
    },
  ],
});
