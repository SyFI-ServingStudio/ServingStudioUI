import type { Page } from '@playwright/test';

import { TEST_KERNEL_KINDS } from '../../src/test/kernelKinds';

/**
 * The kernel kinds' DOC titles and categories, as the Analyzer serves them:
 * every page that names or groups a kernel reads them. The unit tests' cut of
 * the vocabulary covers every kind these fixtures name.
 */
export async function serveKernelKinds(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/kernel-kinds', (route) =>
    route.fulfill({ json: { schema_version: 1, ...TEST_KERNEL_KINDS } }),
  );
}
