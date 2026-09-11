import type { Page } from '@playwright/test';

import { conservationWith, serveRunConservation, serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

/**
 * The eleventh slice: whether to believe the rest of the page.
 *
 * Every other panel is computed from the run's logs. This one asks whether
 * those logs add up — twelve identities on a real run, five here, each
 * restating a quantity two ways. A KV chart drawn over a log whose token totals
 * do not reconcile is a confident picture of a run that did not happen, and
 * nothing else on the page can say so.
 *
 * Two things are under test. When everything reconciles the panel is one line,
 * because a section that took a screen to say "nothing is wrong" is a section
 * that gets scrolled past on the day it says something else. And when something
 * does not reconcile, the *status* leads — not the percentage, which is decided
 * differently and which is missing entirely on the checks that matter most.
 */

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function stubAnalyzer(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
}

async function open(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${ADDRESS}`);
}

test('shows every reconciliation row on a run whose logs add up', async ({ page }) => {
  await stubAnalyzer(page);
  await open(page);

  const panel = page.getByTestId('conservation-run');
  await expect(panel).toContainText('all balanced');
  await expect(panel.getByText('OK', { exact: true })).toHaveCount(5);
  await expect(panel).toContainText('prefill_tokens');
  await expect(panel).toContainText('decode_passes');
  await expect(panel).toContainText('cost_log_batch_self_consistency');
});

test('leads with the check that failed, and says what it means for the page', async ({ page }) => {
  // The FFN token pass 40% short. That quantity is the one the batch panel
  // draws its distributions from, so this is not a footnote about the analysis
  // — it is a reason to distrust a number three sections down.
  await stubAnalyzer(page);
  await serveRunConservation(page, conservationWith('ffn_token_pass', 654848, 400000));
  await open(page);

  const panel = page.getByTestId('conservation-run');
  await expect(panel).toContainText('imbalance flagged');
  await expect(panel.getByText('FAIL', { exact: true })).toHaveCount(1);
  await expect(panel.getByText('OK', { exact: true })).toHaveCount(4);
  await expect(panel).toContainText('ffn_token_pass');
  await expect(panel).toContainText('400,000');
  await expect(panel).toContainText('-38.92% vs exp');
});

test('says what a check that expected nothing found, having no percentage to give', async ({
  page,
}) => {
  // `expected` is zero, so the producer's percentage is an infinity and JSON
  // carries it as null. This is the most serious result a check can have and
  // the one with an empty percentage column — a panel that led with the
  // percentage would have nothing to say about it.
  await stubAnalyzer(page);
  await serveRunConservation(page, conservationWith('prefix_hit_bounds', 0, 3));
  await open(page);

  const panel = page.getByTestId('conservation-run');
  await expect(panel).toContainText('prefix_hit_bounds');
  await expect(panel).toContainText('— vs exp');
  await expect(panel.getByText('FAIL', { exact: true })).toBeVisible();
});

test('separates a gap worth a look from one worth stopping for', async ({ page }) => {
  // 1% out: above the 0.01% tolerance and below the 5% line. The two verdicts
  // are different news and the panel says which — a single "something is
  // wrong" would put a rounding-scale discrepancy beside a missing third of
  // the workload.
  await stubAnalyzer(page);
  await serveRunConservation(page, conservationWith('decode_passes', 130560, 131866));
  await open(page);

  const panel = page.getByTestId('conservation-run');
  await expect(panel.getByText('WARN', { exact: true })).toBeVisible();
  await expect(panel.getByText('FAIL', { exact: true })).toHaveCount(0);
  await expect(panel).toContainText('decode_passes');
  await expect(panel).toContainText('+1% vs exp');
});

test.describe('with the run’s request log absent', () => {
  test('says the analysis has nothing rather than reporting that all is well', async ({ page }) => {
    // The failure mode this branch exists against: a panel whose absent state
    // looked like its healthy state would tell a reader the logs reconcile on
    // a run where nothing was checked at all.
    await stubAnalyzer(page);
    await serveRunConservation(page, {
      schema_version: 1,
      available: false,
      reason: 'request_slo.parquet not found',
    });
    await open(page);

    await expect(page.getByText('request_slo.parquet not found')).toBeVisible();
    await expect(page.getByTestId('conservation-run')).toHaveCount(0);
    // And the rest of the page still renders.
    await expect(page.getByTestId('run-headline')).toBeVisible();
  });
});
