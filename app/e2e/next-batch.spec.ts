import type { Page } from '@playwright/test';

import { RUN_TOPOLOGY, serveRunPage } from './fixtures/run';
import { expect, test } from './quality.fixture';

const RUN = '20260907_0_llama3_h200_throughput';
const ADDRESS = `#/result/run/${RUN}?w=w_main`;

async function open(
  page: Page,
  suffix = '',
  topology: unknown | 'failed' | undefined = undefined,
): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) =>
    route.fulfill({ status: 404, body: 'not served' }),
  );
  await serveRunPage(page);
  if (topology !== undefined) {
    await page.route('**/api/analyzer/v1/runs/*/subjects/topology/payload*', (route) =>
      topology === 'failed'
        ? route.fulfill({ json: { schema_version: 1, invalid: true } })
        : route.fulfill({ json: topology }),
    );
  }
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/${ADDRESS}${suffix}`);
}

test('does not add batch composition to the old cluster stage', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Total batch tokens', { exact: true })).toHaveCount(0);
});

test('restores the old three-card pool batch charts', async ({ page }) => {
  await open(page, '&at=pool:decode&t=500');

  const panel = page.getByTestId('batch-pool-decode');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('batch-pool-total_tokens')).toContainText('Total batch tokens');
  await expect(page.getByTestId('batch-pool-prefill_tokens')).toContainText('Prefill tokens');
  await expect(page.getByTestId('batch-pool-decode_requests')).toContainText('Decode requests');
  await expect(panel.getByText('pool aggregate ∥ pool average · wall-clock snapshot')).toHaveCount(
    3,
  );
  await expect(
    page.getByTestId('batch-pool-total_tokens').getByText('iter', { exact: true }),
  ).toBeVisible();

  const cards = [
    page.getByTestId('batch-pool-total_tokens'),
    page.getByTestId('batch-pool-prefill_tokens'),
    page.getByTestId('batch-pool-decode_requests'),
  ];
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  expect(boxes.every((box) => box !== null)).toBe(true);
  expect(boxes[0]?.y).toBe(boxes[1]?.y);
  expect(boxes[1]?.y).toBe(boxes[2]?.y);

  await cards[0].getByRole('button', { name: 'Expand Total batch tokens' }).click();
  await expect(page.getByRole('dialog')).toContainText('Total batch tokens');
});

test('restores the old three-card worker batch charts', async ({ page }) => {
  await open(page, '&at=pool:decode.worker:1&t=500');

  const panel = page.getByTestId('batch-worker');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('worker: decode/1')).toHaveCount(3);
  await expect(panel.getByText('selected worker · sampled invocations')).toHaveCount(3);
  await expect(
    page.getByTestId('batch-worker-total_tokens').getByText('iter', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('batch-pool-decode')).toHaveCount(0);
});

test('keeps FFN composition unavailable instead of drawing producer zeroes', async ({ page }) => {
  const ffnTopology = {
    ...RUN_TOPOLOGY,
    params: {
      ...RUN_TOPOLOGY.params,
      pools: {
        ...RUN_TOPOLOGY.params.pools,
        decode: {
          ...RUN_TOPOLOGY.params.pools.decode,
          groups: [
            {
              ...RUN_TOPOLOGY.params.pools.decode.groups[0],
              worker: { type: 'disagg_ffn' },
            },
          ],
        },
      },
    },
  };
  await open(page, '&at=pool:decode', ffnTopology);

  await expect(
    page.getByTestId('batch-pool-total_tokens').locator('div[role="img"]'),
  ).toBeVisible();
  for (const metric of ['prefill_tokens', 'decode_requests']) {
    const card = page.getByTestId(`batch-pool-${metric}`);
    await expect(card.locator('div[role="img"]')).toHaveCount(0);
    await expect(card).toContainText('FFN cost logs retain only routed total tokens');
  }
});

test('does not draw batch curves without worker-kind metadata', async ({ page }) => {
  await open(page, '&at=pool:decode', 'failed');

  for (const metric of ['total_tokens', 'prefill_tokens', 'decode_requests']) {
    const card = page.getByTestId(`batch-pool-${metric}`);
    await expect(card.locator('div[role="img"]')).toHaveCount(0);
    await expect(card).toContainText('topology');
  }
});
