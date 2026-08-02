import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useViz } from '../store';
import ChartCard from './ChartCard';
import { useChartFocusDialog, type ChartFocusPayload } from './ChartFocusContext';
import { ChartFocusProvider } from './ChartFocusProvider';

const chartRender = vi.hoisted(() => vi.fn());

vi.mock('./EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => {
    chartRender(ariaLabel);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

beforeEach(() => {
  chartRender.mockClear();
  useViz.setState({ selectionSurface: 'run', runPanelId: null, cursorMs: null });
});

function renderWithFocus(ui: ReactNode, observe?: (focus: ChartFocusPayload | null) => void) {
  function FocusObserver() {
    const { focus } = useChartFocusDialog();
    observe?.(focus);
    return null;
  }
  return render(
    <ChartFocusProvider>
      {ui}
      <FocusObserver />
    </ChartFocusProvider>,
  );
}

describe('ChartCard', () => {
  it('keeps the expand control visible when reached from the keyboard', async () => {
    const user = userEvent.setup();
    renderWithFocus(
      <ChartCard evidenceId="throughput" title="Throughput" option={{ series: [] }} />,
    );

    const expand = screen.getByRole('button', { name: 'Expand Throughput' });
    await user.tab();

    expect(expand).toHaveFocus();
    expect(getComputedStyle(expand).opacity).toBe('1');
  });

  it('subscribes only to stable actions and opens the shared dialog payload', async () => {
    const user = userEvent.setup();
    const option = { series: [] };
    let observed: ChartFocusPayload | null = null;
    renderWithFocus(
      <ChartCard
        evidenceId="utilization"
        title="GPU utilization"
        caption="GPU busy fraction"
        option={option}
      />,
      (focus) => {
        observed = focus;
      },
    );
    const initialChartRenders = chartRender.mock.calls.length;

    act(() => useViz.setState({ cursorMs: 1_000 }));
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);

    await user.click(screen.getByRole('button', { name: 'Expand GPU utilization' }));
    expect(observed).toEqual({
      title: 'GPU utilization',
      caption: 'GPU busy fraction',
      option,
    });
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);
  });

  it('selects the whole evidence surface without rerendering its chart', async () => {
    const user = userEvent.setup();
    renderWithFocus(
      <ChartCard evidenceId="throughput" title="Throughput" option={{ series: [] }} />,
    );
    const initialChartRenders = chartRender.mock.calls.length;
    const surface = screen
      .getByRole('button', { name: 'Select Throughput panel' })
      .closest('[data-evidence-id]');

    expect(surface).not.toBeNull();
    await user.click(surface!);

    expect(useViz.getState().runPanelId).toBe('throughput');
    expect(surface).toHaveAttribute('data-agent-selected', 'true');
    expect(screen.getByText('Selected for agent')).toBeVisible();
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);
  });

  it('updates prediction evidence without falling back to the retained run', async () => {
    const user = userEvent.setup();
    useViz.setState({
      selectionSurface: 'prediction',
      runPanelId: 'throughput',
      predictionSelection: {
        kind: 'prediction',
        workspaceId: 'w_main',
        predictionId: 'p_test',
        panelId: null,
        caseId: '40',
        operationId: 'post_norm',
        leafId: 12,
        parallelId: null,
        optimalityMode: 'unlocked',
      },
    });
    renderWithFocus(
      <ChartCard
        evidenceId="optimality-breakdown"
        title="Optimality Breakdown"
        option={{ series: [] }}
      />,
    );
    const initialChartRenders = chartRender.mock.calls.length;

    await user.click(
      screen
        .getByRole('button', { name: 'Select Optimality Breakdown panel' })
        .closest('[data-evidence-id]')!,
    );

    expect(useViz.getState().selectionSurface).toBe('prediction');
    expect(useViz.getState().predictionSelection?.panelId).toBe('optimality-breakdown');
    expect(useViz.getState().runPanelId).toBe('throughput');
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);
  });
});
