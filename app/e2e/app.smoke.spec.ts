import {
  expectKernelShareSelectionStable,
  expectRenderedCharts,
  openRealRun,
  scopeToPool,
  scopeToWorker,
} from './helpers';
import { expect, test } from './quality.fixture';

test('loads the real analyzer folder and drills through a composite worker identity', async ({
  page,
}) => {
  await openRealRun(page);

  await expect(page.getByRole('heading', { name: 'Simulation overview', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trace overview', level: 3 })).toBeVisible();
  await expect(page.getByText('Trace distribution not generated', { exact: true })).toBeVisible();
  await expectRenderedCharts(page);

  const poolButton = page.getByRole('button', { name: 'Scope to pool attn' });
  await poolButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Pool · attn', level: 2 })).toBeVisible();

  await scopeToWorker(page, 'attn/0');
  await expectKernelShareSelectionStable(page);

  await page.getByRole('button', { name: 'Scope to whole deployment' }).click();
  await expect(page.getByRole('heading', { name: 'Cluster outcome', level: 2 })).toBeVisible();
});

test('uses one fully rounded aggregate return in the run masthead', async ({ page }) => {
  await openRealRun(page);

  const aggregateReturn = page.getByRole('link', { name: 'Return to aggregate overview' });
  await expect(aggregateReturn).toBeVisible();
  expect(
    await aggregateReturn.evaluate((element) => {
      const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius);
      return radius >= element.getBoundingClientRect().height / 2;
    }),
  ).toBe(true);
  await expect(page.getByRole('navigation', { name: 'Analyzer workspace' })).toHaveCount(0);
  await expect(page.getByText('Current run', { exact: true })).toBeVisible();
});

test('selects a run-level chart as agent evidence from the whole card', async ({ page }) => {
  await openRealRun(page);

  const throughputPanel = page.locator('[data-evidence-id="panel:throughput"]');
  await throughputPanel.click({ position: { x: 12, y: 90 } });

  await expect(throughputPanel).toHaveAttribute('data-agent-selected', 'true');
  await expect(throughputPanel.getByText('Selected for agent', { exact: true })).toBeVisible();
  await expect(
    throughputPanel.getByRole('button', { name: 'Select Throughput panel' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('restores aggregate evidence from a canonical agent deep link', async ({ page }) => {
  await page.goto(
    '/#/aggregate?experiment=s_fixture_llama3_8b_tp_rate&panel=tpot&metric=tpot_mean_ms&statistic=mean&coordinates=%7B%22request_rate%22%3A50%2C%22tensor_parallel%22%3A4%7D',
  );

  const selectedPanel = page.locator('[data-evidence-id="panel:tpot"][data-agent-selected="true"]');
  await expect(selectedPanel).toBeVisible();
  await expect(selectedPanel.getByText('Selected for agent', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /Mean TPOT by request_rate/ })).toBeVisible();
});

test('selects a scalar metric panel from anywhere on its card', async ({ page }) => {
  await page.goto('/#/aggregate');

  const throughputPanel = page.locator('[data-evidence-id="panel:total_tps"]');
  await throughputPanel.click({ position: { x: 12, y: 90 } });

  await expect(throughputPanel).toHaveAttribute('data-agent-selected', 'true');
  await expect(throughputPanel).toBeVisible();
  await expect(throughputPanel.getByText('Selected for agent', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/panel=total_tps/);
  await expect(page).toHaveURL(/metric=total_tps/);
});

test('accepts a same-origin agent navigation command and acknowledges it', async ({ page }) => {
  await page.goto('/#/run');
  await page.evaluate(() => {
    const navigationResults: unknown[] = [];
    const selectionChanges: unknown[] = [];
    Object.assign(window, {
      __navigationResults: navigationResults,
      __selectionChanges: selectionChanges,
    });
    window.addEventListener('message', (event) => {
      if (
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { type?: unknown }).type === 'navigation-result'
      ) {
        navigationResults.push(event.data);
      }
      if (
        event.data &&
        typeof event.data === 'object' &&
        (event.data as { type?: unknown }).type === 'selection-change'
      ) {
        selectionChanges.push(event.data);
      }
    });
    window.postMessage(
      {
        protocol: 'vibesim.analyzer/v1',
        requestId: 'agent-request-1',
        type: 'navigate',
        target: {
          protocol: 'vibesim.analyzer/v1',
          experimentId: 's_fixture_llama3_8b_tp_rate',
          panelId: 'ttft',
          metricKey: 'ttft_mean_ms',
          coordinates: { request_rate: 50, tensor_parallel: 4 },
        },
      },
      window.location.origin,
    );
  });

  await expect(
    page.locator('[data-evidence-id="panel:ttft"][data-agent-selected="true"]'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __navigationResults?: Array<{ requestId?: string; status?: string }>;
            }
          ).__navigationResults,
      ),
    )
    .toContainEqual(expect.objectContaining({ requestId: 'agent-request-1', status: 'ok' }));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __selectionChanges?: Array<{
                selection?: { kind?: string; panelId?: string; runId?: string };
              }>;
            }
          ).__selectionChanges,
      ),
    )
    .toContainEqual(
      expect.objectContaining({
        selection: expect.objectContaining({
          kind: 'aggregate',
          panelId: 'ttft',
        }),
      }),
    );
});

test('opens the FFN pool through the same stable pool control', async ({ page }) => {
  await openRealRun(page);
  await scopeToPool(page, 'ffn');
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/0' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scope to worker ffn/1' }).first()).toBeVisible();
  await scopeToWorker(page, 'ffn/0');
});

test('opens the launcher-defined sweep aggregate workspace', async ({ page }) => {
  await page.goto('/#/aggregate');
  await expect(page.getByRole('heading', { name: 'Sweep aggregate', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Throughput', level: 3 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Request SLO', level: 3 })).toBeVisible();
  await expect(page.getByRole('img', { name: /Total throughput by request_rate/ })).toBeVisible();

  await page.getByRole('button', { name: 'unified' }).click();
  await expect(page.getByRole('listbox', { name: 'Experiments by date' })).toContainText(
    '0_llama3_8b_tp_rate',
  );
  await expect(page.getByText('1/2 shown', { exact: true })).toBeVisible();

  const scrollBeforeSelection = await page.evaluate(() => window.scrollY);
  await page.getByRole('option', { name: '20260727_0_llama3_8b_tp_rate' }).click();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(scrollBeforeSelection);
});

test('opens an unclaimed run through the singleton aggregate interface', async ({ page }) => {
  await page.goto('/#/aggregate');
  await page.getByRole('option', { name: /20260715_1_afd_ui_reanalysis/ }).click();

  await expect(page.getByText('54,635 tok/s', { exact: true })).toBeVisible();
  await expect(page.getByText('68.9 %', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /by request_rate/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect run →' }).click();
  await expect(page.getByRole('heading', { name: 'Simulation overview', level: 3 })).toBeVisible();
});
