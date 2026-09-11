import { expect, test, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';

function fixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;
}

const descriptorJson = fixture<{ display_name: string; lifecycle: unknown }>(
  './fixtures/alignment/alignment_descriptor.json',
);
const iterationReport = fixture<unknown>(
  './fixtures/alignment/reports/alignment_iteration_report.json',
);
const iterationSeries = fixture<unknown>(
  './fixtures/alignment/payloads/alignment_iteration_series.json',
);
const timelineIndex = fixture<unknown>('./fixtures/alignment/payloads/alignment_timeline.json');
const workloadSeries = fixture<unknown>(
  './fixtures/alignment/payloads/alignment_workload_series.json',
);
const e2eSeries = fixture<unknown>('./fixtures/alignment/payloads/alignment_e2e_series.json');
const breakdown6 = fixture<unknown>('./fixtures/alignment/iterations/breakdown_6.json');
const breakdown1025 = fixture<unknown>('./fixtures/alignment/iterations/breakdown_1025.json');
const breakdown2045 = fixture<unknown>('./fixtures/alignment/iterations/breakdown_2045.json');
const timeline6 = fixture<unknown>('./fixtures/alignment/iterations/timeline_6.json');
const timeline1025 = fixture<unknown>('./fixtures/alignment/iterations/timeline_1025.json');
const timeline2045 = fixture<unknown>('./fixtures/alignment/iterations/timeline_2045.json');

const ALIGNMENT_ID = 'al_fixture_llama3_8b_tp4';
const UPDATED = '2026-08-05T00:00:00Z';
const CATALOG = {
  protocol_version: 1,
  generated_at: UPDATED,
  alignments: [
    {
      workspace_id: 'w_main',
      alignment_id: ALIGNMENT_ID,
      display_name: descriptorJson.display_name,
      kernel_analysis: 'complete',
      e2e_analysis: 'complete',
      updated_at: UPDATED,
    },
  ],
};
const DESCRIPTOR = {
  schema_version: 1,
  alignment_id: ALIGNMENT_ID,
  kind: 'alignment',
  display_name: descriptorJson.display_name,
  lifecycle: descriptorJson.lifecycle,
  prediction: null,
  subjects: {
    iteration: { status: 'ready', views: ['report', 'payload'], has_iteration_detail: true },
    timeline: { status: 'ready', views: ['payload'], has_iteration_detail: true },
    workload: { status: 'ready', views: ['payload'], has_iteration_detail: false },
    e2e: { status: 'ready', views: ['payload'], has_iteration_detail: false },
  },
};

const breakdowns = new Map<string, unknown>([
  ['6', breakdown6],
  ['1025', breakdown1025],
  ['2045', breakdown2045],
]);
const timelines = new Map<string, unknown>([
  ['6', timeline6],
  ['1025', timeline1025],
  ['2045', timeline2045],
]);

function fulfill(route: Route, json: unknown) {
  return route.fulfill({ json });
}

async function stubAlignment(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/analyzer/v1/alignments') return fulfill(route, CATALOG);
    const root = `/api/analyzer/v1/alignments/${ALIGNMENT_ID}`;
    if (path === `${root}/descriptor`) return fulfill(route, DESCRIPTOR);
    if (path === `${root}/subjects/iteration/report`) return fulfill(route, iterationReport);
    if (path === `${root}/subjects/iteration/payload`) return fulfill(route, iterationSeries);
    if (path === `${root}/subjects/timeline/payload`) return fulfill(route, timelineIndex);
    if (path === `${root}/subjects/workload/payload`) return fulfill(route, workloadSeries);
    if (path === `${root}/subjects/e2e/payload`) return fulfill(route, e2eSeries);

    const detail = path.match(/\/subjects\/(iteration|timeline)\/iterations\/(\d+)$/);
    if (detail !== null) {
      const body = (detail[1] === 'iteration' ? breakdowns : timelines).get(detail[2]);
      if (body !== undefined) return fulfill(route, body);
    }
    return route.fulfill({ status: 404, body: `No fixture for ${path}` });
  });
}

async function openAlignment(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.goto(`/#/result/alignment/${ALIGNMENT_ID}?w=w_main`);
  await expect(page.getByRole('heading', { name: descriptorJson.display_name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The whole run' })).toBeVisible();
}

test('reproduces the alignment page and stores iteration selection in Location', async ({
  page,
}) => {
  await stubAlignment(page);
  await openAlignment(page);
  const names = [
    descriptorJson.display_name,
    'Every iteration, paired',
    'What is in the comparison, and what is not',
    'One cycle, split by operation',
    "Where one iteration's wall clock went",
    'The whole run',
  ];
  for (const name of names) {
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }

  await expect(page).toHaveURL(/at=iteration:1025/);
  await page.locator('[role="option"][title*="iteration 6"]').first().click();
  await expect(page).toHaveURL(/at=iteration:6/);
  await expect(page.getByText(/REAL EXAMPLE ITERATION · iteration 6/)).toBeVisible();
});
