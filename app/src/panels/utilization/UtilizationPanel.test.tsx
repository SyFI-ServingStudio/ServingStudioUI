import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Location } from '../../location';
import { ChartFocusProvider } from '../../ui/controls/ChartFocusProvider';
import {
  PoolUtilizationPanel,
  RunUtilizationPanel,
  WorkerUtilizationPanel,
} from './UtilizationPanel';

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
  focus: { path: [], panel: null, options: {}, cursorMs: 2_000 },
  chat: null,
};

const PAYLOAD = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/run-1',
    gpu_name: 'NVIDIA H200',
    unit: 'fraction of pool workers busy (0-1)',
    worker_unit: 'fraction of worker/GPU busy time (0-1)',
    avg: {},
  },
  t_start_ms: [0, 2_000],
  t_end_ms: [2_000, 4_000],
  series: [
    { key: 'pool_0', label: 'prefill', pool_tag: 'prefill', util: [0.4, 0.6] },
    { key: 'pool_1', label: 'decode', pool_tag: 'decode', util: [0.6, 0.8] },
  ],
  worker_series: [
    { key: 'p0w0', label: 'prefill/0', pool_tag: 'prefill', worker_id: 0, util: [0.3, 0.5] },
    { key: 'p0w1', label: 'prefill/1', pool_tag: 'prefill', worker_id: 1, util: [0.5, 0.7] },
    { key: 'p1w0', label: 'decode/0', pool_tag: 'decode', worker_id: 0, util: [0.8, 0.9] },
    { key: 'p1w1', label: 'decode/1', pool_tag: 'decode', worker_id: 1, util: [0.4, 0.7] },
  ],
  definitions: {},
};

function respond(body: unknown = PAYLOAD) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"utilization-rev"' },
      }),
    ),
  );
}

function show(
  Panel: typeof RunUtilizationPanel,
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

describe('UtilizationPanel', () => {
  it('reproduces the cluster chart with every worker and bold pool average', async () => {
    respond();
    show(RunUtilizationPanel);

    expect(await screen.findByText('4 worker lines · 2 pool averages')).toBeInTheDocument();
    expect(screen.getByText('GPU utilization · all pools')).toBeInTheDocument();
    expect(seriesNames()).toEqual([
      'prefill/0',
      'prefill/1',
      'decode/0',
      'decode/1',
      'prefill average',
      'decode average',
      undefined,
    ]);
  });

  it('scopes the pool chart to its workers and average', async () => {
    respond();
    show(PoolUtilizationPanel, {
      ...BASE,
      focus: { ...BASE.focus, path: [{ at: 'pool', role: 'decode' }] },
    });

    expect(await screen.findByText('2 workers · pool: decode')).toBeInTheDocument();
    expect(seriesNames()).toEqual(['decode/0', 'decode/1', 'decode average', undefined]);
  });

  it('scopes the worker chart to the selected GPU', async () => {
    respond();
    show(WorkerUtilizationPanel, {
      ...BASE,
      focus: {
        ...BASE.focus,
        path: [
          { at: 'pool', role: 'decode' },
          { at: 'worker', id: '1' },
        ],
      },
    });

    expect(await screen.findByText('worker: decode/1')).toBeInTheDocument();
    expect(screen.getByText('selected worker only')).toBeInTheDocument();
    expect(seriesNames()).toEqual(['decode/1', undefined]);
  });

  it('keeps an unavailable payload inside the same chart card', async () => {
    respond({
      schema_version: 1,
      meta: { log_dir: 'logs/run-1', available: false, reason: 'no intervals' },
      t_start_ms: [],
      t_end_ms: [],
      series: [],
      worker_series: [],
    });
    show(RunUtilizationPanel);

    expect(await screen.findByText(/no intervals/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
