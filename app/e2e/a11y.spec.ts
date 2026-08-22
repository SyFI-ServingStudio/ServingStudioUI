import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import {
  WORKING_STYLES,
  openAgentStart,
  openAlignmentFixture,
  openRealRun,
  scopeToWorker,
} from './helpers';
import { expect, test } from './quality.fixture';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function expectNoA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
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

test('an alignment bundle meets automated WCAG A/AA checks', async ({ page }) => {
  await openAlignmentFixture(page);
  await expectNoA11yViolations(page);
});

test('the working-style grid meets automated WCAG A/AA checks', async ({ page }) => {
  // The grid carries its meaning in a wash and a dot, so the accessible name of
  // each cell is the only thing that spells the combination out. Checking every
  // cell, not just the default one, keeps a selected cell from losing its name
  // to the styling that marks it.
  await openAgentStart(page);
  const grid = page.getByRole('radiogroup', { name: 'Agent working style' });
  for (const name of WORKING_STYLES) {
    await grid.getByRole('radio', { name, exact: true }).click();
    await expectNoA11yViolations(page);
  }
});
