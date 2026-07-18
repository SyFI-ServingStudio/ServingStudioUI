import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import type { ReadyKernelLadderProjection } from './optimalityKernelLadder';
import { optimalityKernelLadderOption } from './optimalityKernelLadderOption';

const projection: ReadyKernelLadderProjection = {
  status: 'ready',
  label: 'attn/0',
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
  it('uses item-level tooltips so one hovered chunk reports one kernel', () => {
    const option = optimalityKernelLadderOption(projection, CHART_THEME);

    expect(option.tooltip).toMatchObject({ trigger: 'item' });
    const series = option.series;
    expect(Array.isArray(series)).toBe(true);
    if (!Array.isArray(series)) return;
    expect(series[0]).toMatchObject({ name: 'model.gemm', data: [8] });
    expect(series[1]).toMatchObject({ name: 'imbalance (aggregate)', data: [2] });
  });
});
