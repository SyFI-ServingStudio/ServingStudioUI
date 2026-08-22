import {
  WORKING_STYLES,
  expectKernelShareGeometry,
  expectNoHorizontalOverflow,
  openAgentStart,
  openAlignmentFixture,
  openRealRun,
  scopeToPool,
  scopeToWorker,
} from './helpers';
import { expect, test } from './quality.fixture';

test('cluster, pool and worker scopes stay inside the current viewport', async ({ page }) => {
  await openRealRun(page);
  await expectNoHorizontalOverflow(page);

  await scopeToPool(page, 'attn');
  await expectNoHorizontalOverflow(page);

  await scopeToWorker(page, 'attn/0');
  await expectKernelShareGeometry(page);
  await expectNoHorizontalOverflow(page);
});

test('an already-rendered worker view reflows when desktop shrinks to 390px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Resize regression starts on desktop.');
  await openRealRun(page);
  await scopeToWorker(page, 'attn/0');

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
});

test('SLO distributions share one desktop row and stack within 390px', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'This regression exercises a resize.');
  await openRealRun(page);
  const row = page.getByTestId('slo-chart-row');
  await expect(row.locator(':scope > *')).toHaveCount(3);
  await expect(row.getByText('TTFT latency')).toBeVisible();
  await expect(row.getByText('TPOT latency')).toBeVisible();
  await expect(row.getByText('E2E latency')).toBeVisible();

  const desktopCards = await row.locator(':scope > *').evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right };
    }),
  );
  expect(new Set(desktopCards.map((card) => Math.round(card.top))).size).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  const mobileCards = await row.locator(':scope > *').evaluateAll((cards) =>
    cards.map((card) => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top, left: rect.left, right: rect.right };
    }),
  );
  expect(mobileCards[1].top).toBeGreaterThan(mobileCards[0].top);
  expect(mobileCards[2].top).toBeGreaterThan(mobileCards[1].top);
  expect(mobileCards.every((card) => card.left >= -1 && card.right <= 391)).toBe(true);
});

test('aggregate metric sections stay inside the viewport', async ({ page }) => {
  await page.goto('/#/aggregate');
  await expect(page.getByRole('heading', { name: 'Sweep aggregate', level: 1 })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('the alignment page keeps its lanes and boards inside the viewport', async ({ page }) => {
  await openAlignmentFixture(page);
  await expectNoHorizontalOverflow(page);
});

test('the three setup steps reveal and fold in order', async ({ page }) => {
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
