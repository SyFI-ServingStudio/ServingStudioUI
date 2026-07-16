import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChartFocusProvider } from '../../components/ChartFocusProvider';
import { useChartFocusDialog, type ChartFocusPayload } from '../../components/ChartFocusContext';
import type { Slo } from '../../domain/run';
import SloChartRow from './SloChartRow';

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const metric = (label: string): Slo['ttft'] => ({
  label,
  unit: 'ms',
  x: [1, 2],
  y_pct: [50, 100],
  markers: { p50: 1, p90: 2, p99: 2 },
});

const slo: Slo = {
  ttft: metric('TTFT'),
  tpot: metric('TPOT'),
  e2e: metric('E2E'),
};

function renderRow(observe?: (focus: ChartFocusPayload | null) => void) {
  function FocusObserver() {
    const { focus } = useChartFocusDialog();
    observe?.(focus);
    return null;
  }
  return render(
    <ChartFocusProvider>
      <SloChartRow subject={{ subject: 'slo', status: 'ready', schemaVersion: 1, payload: slo }} />
      <FocusObserver />
    </ChartFocusProvider>,
  );
}

describe('SloChartRow', () => {
  it('renders one independently named chart for each SLO distribution', () => {
    renderRow();

    expect(screen.getByTestId('slo-chart-row')).toBeVisible();
    expect(screen.getByRole('img', { name: /TTFT latency/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /TPOT latency/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /E2E latency/ })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /^Expand .* latency$/ })).toHaveLength(3);
  });

  it('focuses only the selected metric chart', async () => {
    const user = userEvent.setup();
    const observe = vi.fn<(focus: ChartFocusPayload | null) => void>();
    renderRow(observe);

    await user.click(screen.getByRole('button', { name: 'Expand TPOT latency' }));

    const focused = observe.mock.calls.at(-1)?.[0];
    expect(focused).toMatchObject({
      title: 'TPOT latency',
      caption: expect.stringContaining('time per output token'),
    });
    expect(((focused as ChartFocusPayload).option.series as unknown[]).length).toBe(1);
  });
});
