import { test as base, expect, type ConsoleMessage } from '@playwright/test';

interface QualityFixtures {
  qualityGuard: void;
}

interface QualityOptions {
  /**
   * Console errors this test provokes on purpose.
   *
   * A test that asserts how the application reports a failing request has to
   * cause one, and the browser logs every non-2xx response itself. Each pattern
   * must be narrow enough to name that one request: a blanket opt-out would
   * turn the guard off for everything else the test does.
   */
  expectedConsoleErrors: RegExp[];
}

function formatConsole(message: ConsoleMessage): string {
  const location = message.location();
  const source = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : '';
  return `console.${message.type()}: ${message.text()}${source}`;
}

/** Automatically turns browser errors and uncaught exceptions into
 * test failures. Network failures stay outside this guard because external
 * fonts are not part of the simulation UI contract. */
export const test = base.extend<QualityFixtures & QualityOptions>({
  expectedConsoleErrors: [[], { option: true }],
  qualityGuard: [
    async ({ page, expectedConsoleErrors }, use) => {
      const failures: string[] = [];
      await page.route('**/api/agent/v1/workspaces', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            workspaces: [
              {
                workspace_id: 'w_main',
                display_name: 'Main',
                state: 'active',
                storage_kind: 'external',
                created_at: 0,
                last_accessed_at: 0,
              },
            ],
          }),
        });
      });
      await page.route('**/api/agent/v1/jobs', (route) => route.fulfill({ json: { jobs: [] } }));
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() !== 'error') return;
        const formatted = formatConsole(message);
        if (expectedConsoleErrors.some((pattern) => pattern.test(formatted))) return;
        failures.push(formatted);
      };
      const onPageError = (error: Error) =>
        failures.push(`pageerror: ${error.stack ?? error.message}`);
      page.on('console', onConsole);
      page.on('pageerror', onPageError);

      await use();

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      expect(failures, failures.join('\n')).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
