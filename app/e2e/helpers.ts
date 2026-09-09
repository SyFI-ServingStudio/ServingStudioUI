import { expect, type Page } from '@playwright/test';

export const REAL_RUN_ID = '20260715_1_afd_ui_reanalysis';

export async function openRealRun(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto('/#/run');
  await expect(page.getByText('Current run', { exact: true })).toBeVisible();
  await expect(page.getByText(REAL_RUN_ID, { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Model overview', level: 3 })).toBeVisible();
}

/** The checked-in alignment bundle, three iterations wide. Built by
 * `scripts/extract-alignment-fixture.mjs` from a real capture, so the page is
 * exercised against the shapes the analyzer actually emits. */
export const FIXTURE_ALIGNMENT_ID = 'al_fixture_llama3_8b_tp4';

export async function openAlignmentFixture(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/#/alignment?workspace=w_main&alignment=${FIXTURE_ALIGNMENT_ID}`);
  await expect(page.getByRole('heading', { name: 'Every iteration, paired' })).toBeVisible();
  await expect(
    page.getByRole('application', { name: /measured and modelled per iteration/i }),
  ).toBeVisible();
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
}

export async function expectRenderedCharts(page: Page): Promise<void> {
  const chartSvgs = page.locator('[role="img"] .echarts-for-react svg');
  await expect(chartSvgs.first()).toBeVisible();
  await expect(async () => {
    const invalidCharts = await chartSvgs.evaluateAll((svgs) =>
      svgs
        .map((element, index) => {
          const svg = element instanceof SVGSVGElement ? element : null;
          const bounds = element.getBoundingClientRect();
          return {
            index,
            layout: [bounds.width, bounds.height],
            intrinsic: [svg?.width.baseVal.value ?? 0, svg?.height.baseVal.value ?? 0],
            textNodes: svg?.querySelectorAll('text').length ?? 0,
          };
        })
        .filter(
          ({ layout, intrinsic, textNodes }) =>
            layout[0] <= 0 ||
            layout[1] <= 0 ||
            intrinsic[0] <= 0 ||
            intrinsic[1] <= 0 ||
            textNodes <= 0,
        ),
    );
    expect(invalidCharts, JSON.stringify(invalidCharts, null, 2)).toEqual([]);
  }).toPass({ timeout: 5_000 });
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
      relativeErrors: segments.map((segment) => {
        const expectedPercent = Number.parseFloat(
          segment.getAttribute('aria-label')?.match(/· ([\d.]+)%/)?.[1] ?? '',
        );
        return (
          segment.getBoundingClientRect().width - (barElement.clientWidth * expectedPercent) / 100
        );
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

  expect(geometry.contentWidth).toBeGreaterThan(0);
  expect(geometry.segmentCount).toBeGreaterThan(1);
  expect(Math.abs(geometry.startError ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(geometry.endError ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(0.75);
  expect(Math.abs(geometry.widthError)).toBeLessThanOrEqual(0.75);
  for (const continuityError of geometry.continuityErrors) {
    expect(Math.abs(continuityError)).toBeLessThanOrEqual(0.75);
  }
  for (const relativeError of geometry.relativeErrors) {
    expect(Math.abs(relativeError)).toBeLessThanOrEqual(0.75);
  }
  expect(geometry.buttonWidths.length).toBeGreaterThan(0);

  const tinyKernelName = geometry.tinySegmentLabels[0]?.split(' — ', 1)[0];
  expect(tinyKernelName).toBeTruthy();
  const equivalentCard = page.getByRole('button', {
    name: `Inspect kernel ${tinyKernelName}`,
  });
  await expect(equivalentCard).toBeVisible();
  await equivalentCard.click();
  await expect(equivalentCard).toHaveAttribute('aria-pressed', 'true');
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

/**
 * One model, all three Codex roles. The `assistant` default is what the
 * single-agent cast runs on, so a catalog that omits it would let the picker
 * offer a mode with no runtime behind it.
 */
export const CODEX_CATALOG = {
  models: [
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      family: 'gpt',
      familyLabel: 'GPT-5.6',
      efforts: ['low', 'medium', 'high', 'xhigh'],
      defaultEffort: 'xhigh',
      serviceTiers: ['default', 'fast'],
      defaultServiceTier: 'default',
      available: true,
    },
  ],
  families: [{ id: 'gpt', label: 'GPT-5.6', available: true, requiredEnvironment: [] }],
  defaults: {
    orchestrator: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
    implementer: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
    assistant: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
  },
};

/** The four plates, by accessible name. */
export const WORKING_STYLES = [
  '2 Agents, Autonomous',
  '2 Agents, Human-in-the-loop',
  'Single Agent, Autonomous',
  'Single Agent, Human-in-the-loop',
];

/**
 * Opens the new-conversation tab with the agent stack stubbed.
 *
 * Page 0 also lists managed jobs and saved conversations; both are stubbed
 * empty so the only thing that can move or fail is the control under test.
 */
export async function openAgentStart(page: Page): Promise<void> {
  await page.route('**/api/codex-backends', (route) => route.fulfill({ json: CODEX_CATALOG }));
  await page.route('**/api/jobs', (route) => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/conversations', (route) =>
    route.fulfill({ json: { conversations: [] } }),
  );
  await page.goto('/');
  await page.getByRole('tab', { name: 'New conversation' }).click();
  await expect(page.getByRole('radiogroup', { name: 'Agent working style' })).toBeVisible();
}
