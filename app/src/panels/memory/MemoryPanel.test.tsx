import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import kvSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';
import type { Location } from '../../location';
import { ChartFocusProvider } from '../../ui/controls/ChartFocusProvider';
import { PoolMemoryPanel, WorkerMemoryPanel } from './MemoryPanel';

const chartRender = vi.hoisted(() => vi.fn());

vi.mock('../../ui/controls/EChart', () => ({
  default: ({ option, ariaLabel }: { option: unknown; ariaLabel: string }) => {
    chartRender(option, ariaLabel);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

const BASE: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'run', workspace: 'w_main', id: 'run-1' },
  focus: {
    path: [{ at: 'pool', role: 'attn' }],
    panel: null,
    options: {},
    cursorMs: 2_000,
  },
  chat: null,
};

function respond(body: unknown = kvSeriesJson) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"kv-rev"' },
      }),
    ),
  );
}

function show(
  Panel: typeof PoolMemoryPanel,
  location: Extract<Location, { view: 'result' }> = BASE,
) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <ChartFocusProvider>
        <Panel location={location} navigate={vi.fn()} />
      </ChartFocusProvider>
    </QueryClientProvider>,
  );
}

function seriesNames(): Array<string | undefined> {
  const option = chartRender.mock.calls.at(-1)?.[0] as { series: Array<{ name?: string }> };
  return option.series.map((series) => series.name);
}

afterEach(() => {
  vi.unstubAllGlobals();
  chartRender.mockClear();
});

describe('MemoryPanel', () => {
  it('reproduces the pool chart with every worker and the pool average', async () => {
    respond();
    show(PoolMemoryPanel);

    expect(await screen.findByText('8 workers · pool: attn')).toBeInTheDocument();
    expect(
      screen.getByText('scoped to attn pool; bold line is the pool average'),
    ).toBeInTheDocument();
    expect(seriesNames()).toEqual([
      'attn/0',
      'attn/1',
      'attn/2',
      'attn/3',
      'attn/4',
      'attn/5',
      'attn/6',
      'attn/7',
      'attn average',
      undefined,
    ]);
  });

  it('reproduces the selected-worker chart', async () => {
    respond();
    show(WorkerMemoryPanel, {
      ...BASE,
      focus: {
        ...BASE.focus,
        path: [
          { at: 'pool', role: 'attn' },
          { at: 'worker', id: '3' },
        ],
      },
    });

    expect(await screen.findByText('worker: attn/3')).toBeInTheDocument();
    expect(screen.getByText('selected worker only')).toBeInTheDocument();
    expect(seriesNames()).toEqual(['attn/3', undefined]);
  });

  it('keeps an unavailable payload inside the chart card', async () => {
    respond({
      schema_version: 1,
      meta: { log_dir: 'logs/run-1', available: false, reason: 'no KV snapshots' },
      t_start_ms: [],
      t_end_ms: [],
      series: [],
    });
    show(PoolMemoryPanel);

    expect(await screen.findByText(/no KV snapshots/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses the old pool identity when a selected worker has no series', async () => {
    respond({
      ...kvSeriesJson,
      series: kvSeriesJson.series.map(({ workers: _workers, ...series }) => series),
    });
    show(WorkerMemoryPanel, {
      ...BASE,
      focus: {
        ...BASE.focus,
        path: [
          { at: 'pool', role: 'attn' },
          { at: 'worker', id: '3' },
        ],
      },
    });

    expect(await screen.findByText('pool: attn')).toBeInTheDocument();
    expect(
      screen.getByText('The KV subject has no cache series for the attn scope.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('selected worker only')).toBeNull();
  });

  it('uses the old pool subtitle when the address names an absent pool', async () => {
    respond();
    show(PoolMemoryPanel, {
      ...BASE,
      focus: { ...BASE.focus, path: [{ at: 'pool', role: 'absent' }] },
    });

    expect(await screen.findByText('pool: absent')).toBeInTheDocument();
    expect(
      screen.getByText('The KV subject has no cache series for the absent scope.'),
    ).toBeInTheDocument();
  });
});
