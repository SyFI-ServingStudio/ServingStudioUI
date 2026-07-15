import { expect, test as base, type ConsoleMessage } from '@playwright/test';

interface QualityFixtures {
  qualityGuard: void;
}

function formatConsole(message: ConsoleMessage): string {
  const location = message.location();
  const source = location.url ? ` (${location.url}:${location.lineNumber ?? 0})` : '';
  return `console.${message.type()}: ${message.text()}${source}`;
}

/** Automatically turns browser warnings, errors and uncaught exceptions into
 * test failures. Network failures stay outside this guard because external
 * fonts are not part of the simulation UI contract. */
export const test = base.extend<QualityFixtures>({
  qualityGuard: [
    async ({ page }, use) => {
      const failures: string[] = [];
      const onConsole = (message: ConsoleMessage) => {
        if (message.type() === 'warning' || message.type() === 'error') {
          failures.push(formatConsole(message));
        }
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
