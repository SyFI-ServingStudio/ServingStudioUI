import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import throughputSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/throughput_segments.json';
import type { Location } from '../../location';
import { ChartFocusProvider } from '../../ui/controls/ChartFocusProvider';
import { RunThroughputPanel } from './ThroughputPanel';
import { PanelEvidenceProvider } from '../PanelEvidenceProvider';

const chartRender = vi.hoisted(() => vi.fn());

vi.mock('../../ui/controls/EChart', () => ({
  default: ({ option, ariaLabel }: { option: unknown; ariaLabel: string }) => {
    chartRender(option, ariaLabel);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

const LOCATION: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'run', workspace: 'w_main', id: 'run-1' },
  focus: { path: [], panel: null, options: {}, cursorMs: 2_000 },
  chat: null,
};

function respond(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"throughput-rev"' },
      }),
    ),
  );
}

function show(navigate = vi.fn()) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <ChartFocusProvider>
        <PanelEvidenceProvider location={LOCATION} navigate={navigate}>
          <RunThroughputPanel location={LOCATION} navigate={navigate} />
        </PanelEvidenceProvider>
      </ChartFocusProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  chartRender.mockClear();
});

describe('RunThroughputPanel', () => {
  it('renders the existing throughput chart from the complete payload', async () => {
    respond(throughputSeriesJson);
    show();

    expect(
      await screen.findByRole('img', {
        name: /Throughput\. Total, prefill, and decode tokens per second/,
      }),
    ).toBeInTheDocument();
    const option = chartRender.mock.calls.at(-1)?.[0] as { series: Array<{ name?: string }> };
    expect(option.series.map((series) => series.name)).toEqual([
      'total',
      'prefill',
      'decode',
      undefined,
    ]);
  });

  it('selects the old throughput evidence id without entering standalone-panel mode', async () => {
    respond(throughputSeriesJson);
    const navigate = vi.fn();
    show(navigate);

    fireEvent.click(await screen.findByRole('button', { name: 'Select Throughput panel' }));
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          panel: null,
          options: { 'evidence-panel': 'throughput' },
        }),
      }),
      'replace',
    );
  });

  it('keeps an unavailable payload inside the same chart card', async () => {
    respond({
      schema_version: 1,
      meta: { log_dir: 'logs/x', available: false, reason: 'fewer than 2 ticks' },
      t_start_ms: [],
      t_end_ms: [],
      series: [],
    });
    show();

    expect(await screen.findByText(/fewer than 2 ticks/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
