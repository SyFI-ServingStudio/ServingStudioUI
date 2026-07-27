import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { openRealRun, scopeToWorker } from './helpers';
import { expect, test } from './quality.fixture';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.flatMap((node) => node.target),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

test('cluster overview meets automated WCAG A/AA checks', async ({ page }) => {
  await openRealRun(page);
  await expectNoA11yViolations(page);
});

test('worker aggregate meets automated WCAG A/AA checks', async ({ page }) => {
  await openRealRun(page);
  await scopeToWorker(page, 'attn/0');
  await expectNoA11yViolations(page);
});

test('sweep aggregate meets automated WCAG A/AA checks', async ({ page }) => {
  await page.goto('/#/aggregate');
  await expect(page.getByRole('heading', { name: 'Sweep aggregate', level: 1 })).toBeVisible();
  await expectNoA11yViolations(page);
});
