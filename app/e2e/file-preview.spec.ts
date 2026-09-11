import type { Page } from '@playwright/test';

import { expect, test } from './quality.fixture';

/**
 * The conversation backend is a separate service from the Analyzer the dev
 * server proxies to, so the file routes are stubbed here. What this spec is really checking is the browser
 * half of the contract: the route resolves, the renderer is chosen from the
 * backend's verdict, the Agent panel is not left full-width, and highlighting
 * loads its grammar chunk without a console error.
 *
 * The refusal branches (403, 404) live in FilePreviewPage.test.tsx instead: any
 * real error response also logs a browser network error, which the shared
 * quality guard correctly treats as a failure.
 */
async function stubFileRoutes(
  page: Page,
  file: { path: string; name: string; language: string | null; body: string },
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', runs: [] },
    }),
  );
  await page.route('**/api/analyzer/v1/sweeps', (route) =>
    route.fulfill({
      json: { protocol_version: 1, generated_at: '2026-09-10T00:00:00Z', sweeps: [] },
    }),
  );
  await page.route('**/api/agent/v1/file/meta*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        workspace_id: 'w_main',
        path: file.path,
        name: file.name,
        size: file.body.length,
        mtime: 0,
        is_dir: false,
        preview_kind: 'text',
        language: file.language,
        preview_byte_limit: 5_242_880,
      }),
    });
  });
  await page.route('**/api/agent/v1/file?*', async (route) => {
    await route.fulfill({
      contentType: 'text/plain; charset=utf-8',
      headers: { 'X-File-Truncated': '0', 'X-File-Total-Bytes': String(file.body.length) },
      body: file.body,
    });
  });
}

const RUST_SOURCE = [
  '// A worker owns one KV store.',
  'pub fn build_worker(kv: KvManager) -> Worker {',
  '    let admission = Admission::new(kv.capacity());',
  '    Worker { kv, admission }',
  '}',
].join('\n');

test('opens a workspace file with syntax colour and canonical navigation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await stubFileRoutes(page, {
    path: 'simulator/src/worker/mod.rs',
    name: 'mod.rs',
    language: 'rust',
    body: RUST_SOURCE,
  });

  await page.goto('/#/file?w=w_main&path=simulator/src/worker/mod.rs&line=3');

  await expect(page.getByRole('heading', { name: 'mod.rs', level: 2 })).toBeVisible();
  const body = page.getByLabel('File contents');
  await expect(body).toContainText('build_worker');
  await expect(body.locator('[data-line]')).toHaveCount(5);
  await expect(body.locator('.hljs-keyword').first()).toBeVisible();

  await page.getByRole('button', { name: 'src', exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/file?w=w_main&path=simulator/src');
});

test('finds text in the open file and steps between matches', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await stubFileRoutes(page, {
    path: 'logs/run.log',
    name: 'run.log',
    language: null,
    body: 'start\nerror: one\nok\nerror: two\n',
  });

  await page.goto('/#/file?w=w_main&path=logs/run.log');

  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByLabel('Find in file').fill('error');

  await expect(page.getByText('1 of 2 lines')).toBeVisible();
  await expect(page.getByLabel('File contents').locator('[data-match]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('2 of 2 lines')).toBeVisible();
});

test('shows a tty-captured log in colour rather than printing its escapes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  // Built rather than pasted: a raw ESC byte in a spec is invisible in review.
  const escape = String.fromCharCode(27);
  await stubFileRoutes(page, {
    path: 'logs/run/stdout.log',
    name: 'stdout.log',
    language: null,
    body:
      `${escape}[2m2026-05-23T08:32:42Z${escape}[0m ${escape}[32m INFO${escape}[0m [build] kernel done\n` +
      `${escape}[2m2026-05-23T08:32:43Z${escape}[0m ${escape}[31mERROR${escape}[0m [build] kernel failed\n`,
  });

  await page.goto('/#/file?w=w_main&path=logs/run/stdout.log');

  const body = page.getByLabel('File contents');
  await expect(body).toContainText('kernel done');
  await expect(body).not.toContainText('[32m');

  // Severity colors must remain distinct and differ from ordinary log text.
  const info = body.locator('span', { hasText: /^ INFO$/ }).first();
  const error = body.locator('span', { hasText: /^ERROR$/ }).first();
  await expect(info).toBeVisible();
  await expect(error).toBeVisible();
  const [infoColor, errorColor, bodyColor] = await Promise.all(
    [info, error, body].map((element) => element.evaluate((node) => getComputedStyle(node).color)),
  );
  expect(infoColor).not.toBe(errorColor);
  expect(infoColor).not.toBe(bodyColor);
  expect(errorColor).not.toBe(bodyColor);
});
