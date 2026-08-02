import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EChartsOption } from 'echarts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChartFocusProvider } from '../../components/ChartFocusProvider';
import type { KernelLadderProjection } from './optimalityKernelLadder';
import OptimalityKernelsCard from './OptimalityKernelsCard';

const renderedOptions = vi.hoisted(() => [] as EChartsOption[]);

vi.mock('../../components/EChart', () => ({
  default: ({ option, ariaLabel }: { option: EChartsOption; ariaLabel: string }) => {
    renderedOptions.push(option);
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

const projection: KernelLadderProjection = {
  status: 'ready',
  label: 'attn/0',
  kernelFilter: null,
  kernelNames: ['model.gemm'],
  kernels: [
    {
      name: 'model.gemm',
      kind: 'single_gemm',
      isComm: false,
      rungs: { balanced: 200, perConfigBest: 150, ignoreNetwork: 80, hardwareLimit: 20 },
    },
  ],
  rows: [],
};

function firstSeriesValue(option: EChartsOption): number | undefined {
  const series = option.series;
  if (!Array.isArray(series)) return undefined;
  const data = series[0]?.data;
  return Array.isArray(data) ? Number(data[0]) : undefined;
}

beforeEach(() => {
  renderedOptions.length = 0;
});

describe('OptimalityKernelsCard scale control', () => {
  it('starts with real GPU-seconds and switches each row to normalized percent', async () => {
    const user = userEvent.setup();
    render(
      <ChartFocusProvider>
        <OptimalityKernelsCard title="Per-kernel optimality" projection={projection} />
      </ChartFocusProvider>,
    );

    expect(screen.getByRole('button', { name: 'Real scale' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(firstSeriesValue(renderedOptions.at(-1) ?? {})).toBe(20);

    await user.click(screen.getByRole('button', { name: 'Normalized' }));

    expect(screen.getByRole('button', { name: 'Normalized' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(firstSeriesValue(renderedOptions.at(-1) ?? {})).toBe(10);
  });

  it('keeps the hardware-optimal fallback after collapsing kernels without R6', async () => {
    const user = userEvent.setup();
    const kernels = Array.from({ length: 18 }, (_, index) => ({
      name: `model.kernel_${index}`,
      kind: 'single_gemm',
      isComm: false,
      rungs: {
        balanced: 100,
        perConfigBest: 100,
        ignoreNetwork: 100,
        hardwareLimit: 70,
      },
    }));
    render(
      <ChartFocusProvider>
        <OptimalityKernelsCard
          title="Per-kernel optimality"
          projection={{
            ...projection,
            kernelNames: kernels.map((kernel) => kernel.name),
            kernels,
          }}
        />
      </ChartFocusProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Normalized' }));

    expect(firstSeriesValue(renderedOptions.at(-1) ?? {})).toBe(70);
  });
});
