import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../store';
import ChartCard from './ChartCard';

const chartRender = vi.hoisted(() => vi.fn());

vi.mock('./EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => {
    chartRender(ariaLabel);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

beforeEach(() => {
  chartRender.mockClear();
  useViz.setState({ cursorMs: null, focus: null });
});

describe('ChartCard', () => {
  it('keeps the expand control visible when reached from the keyboard', async () => {
    const user = userEvent.setup();
    render(<ChartCard title="Throughput" option={{ series: [] }} />);

    const expand = screen.getByRole('button', { name: 'Expand Throughput' });
    await user.tab();

    expect(expand).toHaveFocus();
    expect(getComputedStyle(expand).opacity).toBe('1');
  });

  it('subscribes only to openFocus and opens the shared dialog payload', async () => {
    const user = userEvent.setup();
    const option = { series: [] };
    render(<ChartCard title="GPU utilization" caption="GPU busy fraction" option={option} />);
    const initialChartRenders = chartRender.mock.calls.length;

    act(() => useViz.setState({ cursorMs: 1_000 }));
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);

    await user.click(screen.getByRole('button', { name: 'Expand GPU utilization' }));
    expect(useViz.getState().focus).toEqual({
      title: 'GPU utilization',
      caption: 'GPU busy fraction',
      option,
    });
    expect(chartRender).toHaveBeenCalledTimes(initialChartRenders);
  });
});
