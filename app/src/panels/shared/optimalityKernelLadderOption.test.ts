import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../ui/charts/platform';
import type { ReadyKernelLadderProjection } from './optimalityKernelLadder';
import { optimalityKernelLadderOption } from './optimalityKernelLadderOption';

const projection: ReadyKernelLadderProjection = {
  status: 'ready',
  label: 'main/0',
  kernelFilter: null,
  kernelNames: ['model.gemm'],
  kernels: [
    {
      name: 'model.gemm',
      kind: 'single_gemm',
      isComm: false,
      rungs: { balanced: 8, perConfigBest: 6, ignoreNetwork: 5, hardwareLimit: 4 },
    },
  ],
  rows: [
    {
      label: 'R2 Balanced',
      total: 10,
      values: { 'model.gemm': 8, __imbalance: 2 },
    },
  ],
};

describe('optimalityKernelLadderOption', () => {
  it('shows one segment tooltip without fading the rest of the ladder', () => {
    const option = optimalityKernelLadderOption(projection, CHART_THEME);

    expect(option.tooltip).toMatchObject({ trigger: 'item' });
    expect(Array.isArray(option.series)).toBe(true);
    if (!Array.isArray(option.series)) return;
    expect(option.series[0]).toMatchObject({
      name: 'model.gemm',
      data: [8],
      emphasis: { focus: 'none' },
    });
    expect(option.series[0]).not.toHaveProperty('blur');
    expect(option.series[1]).toMatchObject({ name: 'imbalance (aggregate)', data: [2] });
  });
});
