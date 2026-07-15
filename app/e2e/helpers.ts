import { expect, type Page } from '@playwright/test';

export const REAL_RUN_ID = '20260715_1_afd_ui_reanalysis';

export async function openRealRun(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/');
  const runSwitcher = page.getByRole('combobox', { name: 'Simulation folder' });
  await expect(runSwitcher).toBeEnabled();
  if ((await runSwitcher.inputValue()) !== REAL_RUN_ID) {
    await runSwitcher.fill(REAL_RUN_ID);
    await page.getByRole('option').filter({ hasText: REAL_RUN_ID }).click();
  }
  await expect(runSwitcher).toHaveValue(REAL_RUN_ID);
  await expect(page.getByRole('heading', { name: 'Model overview', level: 2 })).toBeVisible();
}

export async function scopeToPool(page: Page, poolTag: string): Promise<void> {
  await page.getByRole('button', { name: `Scope to pool ${poolTag}` }).click();
  await expect(page.getByRole('heading', { name: `Pool · ${poolTag}`, level: 2 })).toBeVisible();
}

export async function scopeToWorker(page: Page, workerKey: string): Promise<void> {
  await page
    .getByRole('button', { name: `Scope to worker ${workerKey}` })
    .first()
    .click();
  await expect(page.getByText('Aggregate worker evidence only', { exact: true })).toBeVisible();
}

export async function expectRenderedCharts(page: Page): Promise<void> {
  const chartCanvases = page.locator('[role="img"] canvas');
  await expect(chartCanvases.first()).toBeVisible();
  const invalidCanvases = await chartCanvases.evaluateAll((canvases) =>
    canvases
      .map((element, index) => {
        const canvas = element instanceof HTMLCanvasElement ? element : null;
        return {
          index,
          bitmap: canvas ? [canvas.width, canvas.height] : [0, 0],
          layout: [element.clientWidth, element.clientHeight],
        };
      })
      .filter(
        ({ bitmap, layout }) =>
          bitmap[0] <= 0 || bitmap[1] <= 0 || layout[0] <= 0 || layout[1] <= 0,
      ),
  );
  expect(invalidCanvases, JSON.stringify(invalidCanvases, null, 2)).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect(async () => {
    const geometry = await page.evaluate(async () => {
      // ECharts and the responsive shell both settle through ResizeObserver;
      // sample after two paints and retry so a resize cannot pass too early.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const viewportWidth = document.documentElement.clientWidth;
      const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const offenders = [...document.body.querySelectorAll<HTMLElement>('*')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            name:
              element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 80) ?? '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          };
        })
        .filter((rect) => rect.left < -1 || rect.right > viewportWidth + 1)
        .slice(0, 12);
      return { overflow: scrollWidth - viewportWidth, viewportWidth, scrollWidth, offenders };
    });

    expect(geometry.overflow, JSON.stringify(geometry, null, 2)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 3_000 });
}
