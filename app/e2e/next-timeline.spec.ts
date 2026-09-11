import type { Page } from '@playwright/test';

import { serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function open(page: Page, hash = ADDRESS): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${hash}`);
}

test('reproduces the old timeline immediately after the system map', async ({ page }) => {
  await open(page);

  const map = page.getByTestId('system-map');
  const timeline = page.getByTestId('run-timeline');
  const slo = page.getByTestId('slo-chart-row');
  const sectionTitle = page.getByRole('heading', { name: 'System map', level: 2 });
  await expect(timeline).toContainText('Timeline');
  await expect(timeline).toContainText(
    'wall-clock · 512s · active requests in systemaggregate · peak 24All',
  );
  await expect(
    timeline.getByRole('img', { name: 'Request concurrency over simulation time' }).locator('svg'),
  ).toBeVisible();

  const [titleBox, mapBox, timelineBox, sloBox] = await Promise.all([
    sectionTitle.boundingBox(),
    map.boundingBox(),
    timeline.boundingBox(),
    slo.boundingBox(),
  ]);
  expect(mapBox?.y).toBeLessThan(timelineBox?.y ?? 0);
  expect(timelineBox?.y).toBeLessThan(sloBox?.y ?? 0);
  const headingGap = (mapBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0));
  expect(headingGap).toBeGreaterThan(8);
  expect(headingGap).toBeLessThan(36);
  expect(
    Math.abs((timelineBox?.y ?? 0) - ((mapBox?.y ?? 0) + (mapBox?.height ?? 0)) - 12),
  ).toBeLessThan(1);
});

test('keeps drag state local and replaces the URL on release', async ({ page }) => {
  await open(page);
  const slider = page.getByRole('slider', { name: 'Simulation time cursor' });
  const historyLength = await page.evaluate(() => window.history.length);

  await slider.evaluate((input: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, '128058');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.getByTestId('run-timeline')).toContainText('t = 128.06s · 4 active');
  expect(new URL(page.url()).hash).toBe(ADDRESS);

  await slider.dispatchEvent('pointerup');
  await expect.poll(() => new URL(page.url()).hash).toContain('&t=128058');
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  await expect(page.getByTestId('throughput-run').getByText('iter', { exact: true })).toBeVisible();

  await page.getByTestId('run-timeline').getByRole('button', { name: 'All', exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe(ADDRESS);
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
});

test('initializes from a shared cursor and remains visible at worker scope', async ({ page }) => {
  await open(page, `${ADDRESS}&at=pool:decode.worker:1&t=512231.1`);

  const timeline = page.getByTestId('run-timeline');
  await expect(timeline).toContainText('t = 512.23s · 2 active');
  await expect(page.getByTestId('system-map')).toBeVisible();
  await expect(page.getByTestId('slo-chart-row')).toHaveCount(0);
});
