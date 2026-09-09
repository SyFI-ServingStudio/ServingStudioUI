import {
  WORKING_STYLES,
  expectKernelShareGeometry,
  expectNoHorizontalOverflow,
  openAgentStart,
  openRealRun,
  scopeToPool,
  scopeToWorker,
} from './helpers';
import { expect, test } from './quality.fixture';

test(
  'cluster, pool and worker scopes stay inside the current viewport',
  { tag: '@mobile' },
  async ({ page }) => {
    await openRealRun(page);
    await expectNoHorizontalOverflow(page);

    await scopeToPool(page, 'attn');
    await expectNoHorizontalOverflow(page);

    await scopeToWorker(page, 'attn/0');
    await expectNoHorizontalOverflow(page);
  },
);

test(
  'an already-rendered worker view reflows when desktop shrinks to 390px',
  { tag: '@desktop' },
  async ({ page }) => {
    await openRealRun(page);
    await scopeToWorker(page, 'attn/0');

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
  },
);

test(
  'all SLO distributions remain available after resizing',
  { tag: '@desktop' },
  async ({ page }) => {
    await openRealRun(page);
    const row = page.getByTestId('slo-chart-row');
    await expect(row.locator(':scope > *')).toHaveCount(3);
    await expect(row.getByText('TTFT latency')).toBeVisible();
    await expect(row.getByText('TPOT latency')).toBeVisible();
    await expect(row.getByText('E2E latency')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    for (const name of ['TTFT latency', 'TPOT latency', 'E2E latency']) {
      await expect(row.getByText(name)).toBeVisible();
    }
  },
);

test('the three setup steps reveal and fold in order', { tag: '@desktop' }, async ({ page }) => {
  // Picking is the confirmation: each answer folds its own step and opens the
  // next, and the composer does not exist until both earlier steps are answered.
  await openAgentStart(page);
  const grid = page.getByRole('radiogroup', { name: 'Agent working style' });

  await grid.getByRole('radio', { name: WORKING_STYLES[3], exact: true }).click();
  await expect(page.getByRole('button', { name: /Change step 1/ })).toBeVisible();
  await expect(page.getByRole('listbox', { name: 'Workspace for new conversation' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask VibeSim Agent' })).toHaveCount(0);

  await page.getByRole('option', { name: 'Create a new workspace' }).click();
  await expect(page.getByRole('button', { name: /Change step 2/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask VibeSim Agent' })).toBeVisible();

  // Reopening an earlier step returns to the composer, not back through a
  // workspace choice already made.
  await page.getByRole('button', { name: /Change step 1/ }).click();
  await expect(grid.getByRole('radio', { checked: true })).toHaveCount(1);
  await grid.getByRole('radio', { name: WORKING_STYLES[0], exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Ask VibeSim Agent' })).toBeVisible();
});

// Exact worker CostTrees are not generated in the bundled run. Exercise the
// production chart and CostTree controls with a bounded, explicit 95/5 example.
test(
  'kernel shares remain proportional and tiny kernels can be selected',
  { tag: '@mobile' },
  async ({ page }) => {
    await page.goto('/e2e/fixtures/cost-tree.html');
    await expectKernelShareGeometry(page);
    await expectNoHorizontalOverflow(page);
  },
);
