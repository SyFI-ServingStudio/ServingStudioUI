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
  await expect(
    page.getByRole('heading', { name: `Worker · ${workerKey}`, level: 2 }),
  ).toBeVisible();
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

export async function expectKernelShareGeometry(page: Page): Promise<void> {
  const bar = page.getByRole('group', { name: 'Kernel position time share' });
  await expect(bar).toBeVisible();
  const geometry = await bar.evaluate((element) => {
    const barElement = element as HTMLElement;
    const barRect = barElement.getBoundingClientRect();
    const contentLeft = barRect.left + barElement.clientLeft;
    const segments = [...barElement.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    const segmentRects = segments.map((segment) => segment.getBoundingClientRect());
    return {
      contentWidth: barElement.clientWidth,
      segmentCount: segments.length,
      startError: segmentRects[0]?.left - contentLeft,
      endError:
        segmentRects.length === 0
          ? undefined
          : contentLeft + barElement.clientWidth - segmentRects.at(-1)!.right,
      widthError:
        segmentRects.reduce((total, rect) => total + rect.width, 0) - barElement.clientWidth,
      continuityErrors: segmentRects.slice(1).map((rect, index) => {
        return rect.left - segmentRects[index].right;
      }),
      buttonWidths: segments
        .filter((segment) => segment.tagName === 'BUTTON')
        .map((segment) => segment.getBoundingClientRect().width),
      tinySegmentLabels: segments
        .filter((segment) => segment.tagName !== 'BUTTON' && segment.getAttribute('role') === 'img')
        .map((segment) => segment.getAttribute('aria-label'))
        .filter((label): label is string => label !== null),
    };
  });

  expect(geometry.contentWidth).toBeGreaterThanOrEqual(300);
  expect(geometry.segmentCount).toBeGreaterThan(1);
  expect(Math.abs(geometry.startError ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(geometry.endError ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(geometry.widthError)).toBeLessThanOrEqual(0.75);
  for (const continuityError of geometry.continuityErrors) {
    expect(Math.abs(continuityError)).toBeLessThanOrEqual(0.75);
  }
  expect(geometry.buttonWidths.length).toBeGreaterThan(0);
  for (const width of geometry.buttonWidths) expect(width).toBeGreaterThanOrEqual(24);

  const tinyKernelName = geometry.tinySegmentLabels[0]?.split(' — ', 1)[0];
  expect(tinyKernelName).toBeTruthy();
  const equivalentCard = page.getByRole('button', {
    name: `Inspect kernel ${tinyKernelName}`,
  });
  await expect(equivalentCard).toBeVisible();
  const equivalentCardRect = await equivalentCard.boundingBox();
  expect(equivalentCardRect).not.toBeNull();
  expect(equivalentCardRect!.width).toBeGreaterThanOrEqual(24);
  expect(equivalentCardRect!.height).toBeGreaterThanOrEqual(24);
}

export async function expectKernelShareSelectionStable(page: Page): Promise<void> {
  const bar = page.getByRole('group', { name: 'Kernel position time share' });
  const segment = bar.getByRole('button').first();
  const segmentLabel = await segment.getAttribute('aria-label');
  const kernelName = segmentLabel?.split(' — ', 1)[0];
  expect(kernelName).toBeTruthy();
  const kernelCard = page.getByRole('button', { name: `Inspect kernel ${kernelName}` });
  await expect(kernelCard).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  const geometry = async () =>
    kernelCard.evaluate((element) => {
      const card = element as HTMLElement;
      let scroller: HTMLElement | null = card.parentElement;
      while (scroller && getComputedStyle(scroller).overflowX !== 'auto') {
        scroller = scroller.parentElement;
      }
      if (!scroller) throw new Error('CostTree card has no local horizontal scroller.');
      const cardRect = card.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      return {
        x: cardRect.x - scrollerRect.x + scroller.scrollLeft,
        y: cardRect.y - scrollerRect.y + scroller.scrollTop,
        width: cardRect.width,
        height: cardRect.height,
      };
    });
  const before = await geometry();

  await segment.click();

  await expect(segment).toHaveAttribute('aria-pressed', 'true');
  await expect(kernelCard).toHaveAttribute('aria-pressed', 'true');
  await expect(kernelCard.locator('svg')).toHaveCount(1);
  const after = await geometry();
  for (const coordinate of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(after[coordinate] - before[coordinate]),
      `${coordinate} moved: ${JSON.stringify({ before, after })}`,
    ).toBeLessThanOrEqual(0.5);
  }
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
