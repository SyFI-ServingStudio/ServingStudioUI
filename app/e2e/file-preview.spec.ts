import type { Page } from '@playwright/test';

import { expect, test } from './quality.fixture';

/**
 * The conversation backend is not part of the fixture dev server, so the file
 * routes are stubbed here. What this spec is really checking is the browser
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
  await page.route('**/api/file/meta*', async (route) => {
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
  await page.route('**/api/file?*', async (route) => {
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

test('opens a workspace file beside a docked Agent panel, with syntax colour', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await stubFileRoutes(page, {
    path: 'simulator/src/worker/mod.rs',
    name: 'mod.rs',
    language: 'rust',
    body: RUST_SOURCE,
  });

  await page.goto('/#/file?workspace=w_main&path=simulator%2Fsrc%2Fworker%2Fmod.rs&line=3');

  await expect(page.getByRole('heading', { name: 'mod.rs', level: 2 })).toBeVisible();
  const body = page.getByLabel('File contents');
  await expect(body).toContainText('build_worker');
  await expect(body.locator('[data-line]')).toHaveCount(5);

  // The grammar chunk loads after the text, so colour is awaited rather than
  // asserted synchronously.
  await expect(body.locator('.hljs-keyword').first()).toBeVisible();

  // The preview is a workspace view, so the conversation stays beside it
  // rather than being replaced by it.
  await expect(page.getByRole('button', { name: 'Back to experiments' })).toBeVisible();
});

test('finds text in the open file and steps between matches', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await stubFileRoutes(page, {
    path: 'logs/run.log',
    name: 'run.log',
    language: null,
    body: 'start\nerror: one\nok\nerror: two\n',
  });

  await page.goto('/#/file?workspace=w_main&path=logs%2Frun.log');

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

  await page.goto('/#/file?workspace=w_main&path=logs%2Frun%2Fstdout.log');

  const body = page.getByLabel('File contents');
  await expect(body).toContainText('kernel done');
  await expect(body).not.toContainText('[32m');

  // The colour has to survive as a computed style, not just as an attribute.
  const level = body.locator('span', { hasText: /^ INFO$/ }).first();
  await expect(level).toHaveCSS('color', 'rgb(86, 106, 46)');
  await expect(body.locator('span', { hasText: /^ERROR$/ }).first()).toHaveCSS(
    'color',
    'rgb(168, 75, 46)',
  );
});
