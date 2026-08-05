import {
  expectKernelShareGeometry,
  expectNoHorizontalOverflow,
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
