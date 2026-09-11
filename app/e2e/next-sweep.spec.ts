import { expect, test, type Page } from '@playwright/test';

const SWEEP_ID = 's_test';
const CATALOG = {
  protocol_version: 1,
  generated_at: '2026-09-10T00:00:00Z',
  sweeps: [
    {
      workspace_id: 'w_main',
      sweep_id: SWEEP_ID,
      kind: 'sweep',
      display_name: '20260910_0_tp_sweep',
      axes: ['tp', 'dtype'],
      num_runs: 4,
      status: 'ready',
      experiment_date: '2026-09-10',
      deployments: ['unified'],
      traces: ['trace.csv'],
      updated_at: '2026-09-10T00:00:00Z',
    },
  ],
};
const PAYLOAD = {
  protocol_version: 1,
  schema_version: 1,
  workspace_id: 'w_main',
  sweep_id: SWEEP_ID,
  display_name: '20260910_0_tp_sweep',
  meta: { num_axes: 2, num_runs: 4 },
  axes: ['tp', 'dtype'],
  domains: { tp: [1, 2], dtype: ['bf16', 'fp8'] },
  metrics: [
    {
      group: 'throughput',
      key: 'total_tps',
      label: 'Total throughput',
      unit: 'tok/s',
      objective: 'maximize',
    },
    {
      group: 'latency',
      key: 'latency_mean',
      label: 'Mean latency',
      unit: 'ms',
      objective: 'minimize',
    },
    {
      group: 'latency',
      key: 'latency_p99',
      label: 'P99 latency',
      unit: 'ms',
      objective: 'minimize',
    },
  ],
  runs: [1, 2].flatMap((tp) =>
    ['bf16', 'fp8'].map((dtype, index) => ({
      run_id: null,
      coordinates: { tp, dtype },
      labels: { tp: `TP ${tp}`, dtype },
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: {
        total_tps: tp * 100 + index * 25,
        latency_mean: 10 / tp + index,
        latency_p99: 15 / tp + index,
      },
    })),
  ),
  definitions: {},
};

async function openSweep(page: Page) {
  await page.route('**/api/analyzer/v1/**', (route) => route.fulfill({ status: 404, body: 'no' }));
  await page.route('**/api/analyzer/v1/sweeps', (route) => route.fulfill({ json: CATALOG }));
  await page.route(`**/sweeps/${SWEEP_ID}/subjects/sweep/payload*`, (route) =>
    route.fulfill({ json: PAYLOAD }),
  );
  await page.goto(`/#/result/sweep/${SWEEP_ID}?w=w_main`);
}

test('reproduces the sweep aggregate and stores metric/run selection in Location', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
    Element.prototype.scrollIntoView = function (...args) {
      (window as Window & { sweepScrolls?: string[] }).sweepScrolls!.push(
        this.getAttribute('data-sweep-panel') ?? this.tagName,
      );
      return original.apply(this, args as never);
    };
  });
  await openSweep(page);
  const heading = page.getByRole('heading', { name: 'Sweep aggregate' });
  await expect(heading).toBeVisible();
  await expect(page.getByText('4/4')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Total throughput' })).toBeVisible();

  await page.evaluate(() => {
    (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
  });
  await page.getByRole('button', { name: /Total throughput, tp 2, dtype fp8/ }).click();
  expect(
    await page.evaluate(() => (window as Window & { sweepScrolls?: string[] }).sweepScrolls),
  ).toEqual([]);
  await expect(page).toHaveURL(/at=run:~/);
  await expect(page).toHaveURL(/panel=sweep\.page/);
  await expect(page).toHaveURL(/o\.evidence-panel=total_tps/);
  await expect(page).toHaveURL(/o\.metric=total_tps/);
  await expect(
    page.getByRole('button', { name: /Total throughput, tp 2, dtype fp8/ }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /Total throughput, tp 2, dtype fp8/ }).dblclick();
  await expect(page).toHaveURL(/\/result\/sweep\//);

  await page.evaluate(() => {
    (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
  });
  await page.getByRole('button', { name: 'P99' }).click();
  await expect(page).toHaveURL(/o\.evidence-panel=latency/);
  await expect(page).toHaveURL(/o\.metric=latency_p99/);
  await expect(page).toHaveURL(/o\.stat=p99/);
  await expect(page).toHaveURL(/at=run:~/);
  expect(
    await page.evaluate(() => (window as Window & { sweepScrolls?: string[] }).sweepScrolls),
  ).toEqual([]);

  const meanCoordinates = encodeURIComponent(JSON.stringify({ dtype: 'bf16', tp: 1 }));
  await page.evaluate(
    (hash) => {
      (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
      window.location.hash = hash;
    },
    `#/result/sweep/${SWEEP_ID}?w=w_main&at=run:~${meanCoordinates}` +
      '&panel=sweep.page&o.evidence-panel=latency&o.metric=latency_mean&o.stat=mean',
  );
  await expect(page.locator('[data-sweep-panel="latency"]')).toBeFocused();
  expect(
    await page.evaluate(() => (window as Window & { sweepScrolls?: string[] }).sweepScrolls),
  ).toContain('latency');

  await page.evaluate(
    (hash) => (window.location.hash = hash),
    `#/result/sweep/${SWEEP_ID}?w=w_main`,
  );
  await page.evaluate(() => {
    (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
  });
  const p99Coordinates = encodeURIComponent(JSON.stringify({ dtype: 'fp8', tp: 2 }));
  await page.evaluate(
    (hash) => (window.location.hash = hash),
    `#/result/sweep/${SWEEP_ID}?w=w_main&at=run:~${p99Coordinates}` +
      '&panel=sweep.page&o.evidence-panel=latency&o.metric=latency_p99&o.stat=p99',
  );
  await expect(page.locator('[data-sweep-panel="latency"]')).toBeFocused();
  expect(
    await page.evaluate(() => (window as Window & { sweepScrolls?: string[] }).sweepScrolls),
  ).toContain('latency');
});

test('restores a frozen dynamic panel, statistic, and coordinate member', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    (window as Window & { sweepScrolls?: string[] }).sweepScrolls = [];
    Element.prototype.scrollIntoView = function (...args) {
      (window as Window & { sweepScrolls?: string[] }).sweepScrolls!.push(
        this.getAttribute('data-sweep-panel') ?? this.tagName,
      );
      return original.apply(this, args as never);
    };
  });
  await openSweep(page);
  const coordinates = encodeURIComponent(JSON.stringify({ dtype: 'fp8', tp: 2 }));
  await page.goto(
    `/#/result/sweep/${SWEEP_ID}?w=w_main&at=run:~${coordinates}` +
      '&panel=sweep.page&o.evidence-panel=latency&o.metric=latency_p99&o.stat=p99',
  );
  const panel = page.locator('[data-sweep-panel="latency"]');
  await expect(panel).toBeFocused();
  expect(
    await page.evaluate(() => (window as Window & { sweepScrolls?: string[] }).sweepScrolls),
  ).toContain('latency');
  await expect(panel.getByRole('button', { name: 'P99', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByRole('button', { name: /P99 latency, tp 2, dtype fp8/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
