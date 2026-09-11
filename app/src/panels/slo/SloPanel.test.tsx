import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Location } from '../../location';
import { ChartFocusProvider } from '../../ui/controls/ChartFocusProvider';
import { RunSloPanel } from './SloPanel';

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
  focus: { path: [], panel: null, options: {}, cursorMs: null },
  chat: null,
};

const SERIES = [
  ['ttft', 'TTFT', 'ms'],
  ['tpot', 'TPOT', 'ms/token'],
  ['e2e', 'E2E', 'ms'],
].map(([key, label, unit]) => ({
  key,
  label,
  unit,
  n: 2,
  markers: { p50: 1, p90: 2, p99: 2 },
  x: [1, 2],
  y_pct: [50, 100],
}));

function show(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"latency-rev"' },
      }),
    ),
  );
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <ChartFocusProvider>
        <RunSloPanel location={LOCATION} navigate={vi.fn()} />
      </ChartFocusProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  chartRender.mockClear();
});

describe('RunSloPanel', () => {
  it('renders the three old independently focusable CDF cards', async () => {
    show({ schema_version: 1, series: SERIES, definitions: {} });

    expect(await screen.findByRole('img', { name: /TTFT latency/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /TPOT latency/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /E2E latency/ })).toBeInTheDocument();
    expect(screen.getAllByText('request CDF')).toHaveLength(3);
    expect(chartRender).toHaveBeenCalledTimes(3);
  });

  it('keeps a bad payload inside the same three-card row', async () => {
    show({ schema_version: 1, series: SERIES.slice(0, 2), definitions: {} });

    expect(await screen.findAllByText(/missing required e2e/)).toHaveLength(3);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('leaves only a producer-empty metric blank', async () => {
    show({
      schema_version: 1,
      series: [
        SERIES[0],
        {
          ...SERIES[1],
          n: 0,
          markers: { p50: null, p90: null, p99: null },
          x: [],
          y_pct: [],
        },
        SERIES[2],
      ],
      definitions: {},
    });

    expect(await screen.findAllByRole('img')).toHaveLength(2);
    expect(screen.getByTestId('slo-tpot')).toHaveTextContent(
      'No completed requests have this latency metric.',
    );
    expect(screen.getByTestId('slo-ttft').querySelector('[role="img"]')).not.toBeNull();
    expect(screen.getByTestId('slo-e2e').querySelector('[role="img"]')).not.toBeNull();
  });
});
