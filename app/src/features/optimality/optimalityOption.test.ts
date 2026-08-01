import { describe, expect, it } from 'vitest';

import { CHART_THEME } from '../../charts/platform';
import {
  OPTIMALITY_FAMILIES,
  OPTIMALITY_KERNEL_FAMILIES,
  formatGpuSeconds,
  optimalityStackOption,
  type OptimalityStackRow,
} from './optimalityOption';

function row(label: string, hardwareOptimal: number, idle: number): OptimalityStackRow {
  return {
    label,
    total: hardwareOptimal + idle,
    values: { hardwareOptimal, idle },
  };
}

describe('optimalityStackOption', () => {
  it('preserves millisecond and microsecond GPU-time precision', () => {
    expect(formatGpuSeconds(0.0049344897)).toBe('0.0049');
    expect(formatGpuSeconds(0.0000022168)).toBe('2.22e-6');
    expect(formatGpuSeconds(0)).toBe('0');
  });

  it('gives the primary pool row its own axis while workers share a second axis', () => {
    const option = optimalityStackOption(
      [row('attn', 80, 20), row('attn/0', 8, 2), row('attn/1', 6, 4)],
      OPTIMALITY_FAMILIES,
      CHART_THEME,
      { separatePrimaryRowScale: true },
    );

    expect(option).toMatchObject({
      tooltip: { trigger: 'item' },
      title: [{ text: 'Aggregate' }, { text: 'Per worker' }],
      grid: [
        { left: 12, top: 62, containLabel: true },
        { left: 12, top: 156, containLabel: true },
      ],
      xAxis: [
        { gridIndex: 0, name: 'Pool GPU·seconds', position: 'top' },
        { gridIndex: 1, name: 'Worker GPU·seconds', position: 'bottom' },
      ],
      yAxis: [{ gridIndex: 0, data: ['attn · 100.0 GPU·s'] }, { gridIndex: 1 }],
    });

    expect(option.yAxis).toMatchObject([
      { axisLabel: { width: 188, overflow: 'truncate', ellipsis: '…' } },
      { axisLabel: { width: 188, overflow: 'truncate', ellipsis: '…' } },
    ]);

    const series = option.series;
    expect(Array.isArray(series)).toBe(true);
    if (!Array.isArray(series)) return;
    expect(series[0]).toMatchObject({ xAxisIndex: 0, yAxisIndex: 0, data: [80] });
    expect(series[OPTIMALITY_FAMILIES.length]).toMatchObject({
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: [8, 6],
    });
  });

  it('normalizes every kernel row independently to a 100% scale', () => {
    const option = optimalityStackOption(
      [
        {
          label: 'model.gemm',
          total: 200,
          values: { hardwareOptimal: 20, hardwareGap: 60, communication: 70, batching: 50 },
        },
      ],
      OPTIMALITY_KERNEL_FAMILIES,
      CHART_THEME,
      { normalized: true },
    );

    expect(option.xAxis).toMatchObject({
      name: 'Share of balanced GPU·seconds (%)',
      max: 100,
    });
    expect(option.tooltip).toMatchObject({ trigger: 'item' });
    const series = option.series;
    expect(Array.isArray(series)).toBe(true);
    if (!Array.isArray(series)) return;
    expect(series.map((entry) => entry.data)).toEqual([[10], [30], [35], [25]]);
  });

  it('contains long scope labels inside the chart without changing their data value', () => {
    const label = 'main/0 / iter 40 · 10000× large-batch / unified.post_attn.post_norm';
    const option = optimalityStackOption(
      [row(label, 0.00008, 0.00001)],
      OPTIMALITY_FAMILIES,
      CHART_THEME,
    );

    expect(option.grid).toMatchObject({ left: 12, containLabel: true });
    expect(option.yAxis).toMatchObject({
      data: [`${label} · 9.00e-5 GPU·s`],
      axisLabel: { width: 188, overflow: 'truncate', ellipsis: '…' },
    });
  });
});
