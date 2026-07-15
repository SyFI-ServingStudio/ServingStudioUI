import { expectNoHorizontalOverflow, openRealRun, scopeToPool, scopeToWorker } from './helpers';
import { test } from './quality.fixture';

test('cluster, pool and worker scopes stay inside the current viewport', async ({ page }) => {
  await openRealRun(page);
  await expectNoHorizontalOverflow(page);

  await scopeToPool(page, 'attn');
  await expectNoHorizontalOverflow(page);

  await scopeToWorker(page, 'attn/0');
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
