import type { SeriesOption, TooltipComponentOption } from 'echarts';
import { describe, expect, it } from 'vitest';

import type { WorkerComposition } from './composition';
import { workerKernelPositionOption } from './option';

const VALUE: WorkerComposition = {
  worker: { poolTag: 'attn', workerId: '0' },
  kernelTimeMs: 10,
  resultSharePct: 25,
  families: [
    {
      family: 'attn',
      label: 'Attention',
      color: '#123456',
      kernelTimeMs: 8,
      sharePct: 80,
    },
    {
      family: 'gemm',
      label: 'Dense GEMM',
      color: '#654321',
      kernelTimeMs: 2,
      sharePct: 20,
    },
  ],
  slices: [
    {
      position: 'attn.decode',
      kind: 'Attn · decode',
      family: 'attn',
      label: 'Attention',
      color: '#123456',
      kernelTimeMs: 8,
      sharePct: 80,
    },
    {
      position: 'ffn.gemm',
      kind: 'GEMM',
      family: 'gemm',
      label: 'Dense GEMM',
      color: '#654321',
      kernelTimeMs: 2,
      sharePct: 20,
    },
  ],
  mixtureExact: false,
  rawRows: 100,
  sampledRows: 10,
};

describe('workerKernelPositionOption', () => {
  it('keeps the legacy two-row stacks and selected-chunk formatters', () => {
    const option = workerKernelPositionOption(VALUE);
    expect(option.yAxis).toMatchObject({
      inverse: true,
      data: ['by kernel family', 'by kernel position'],
    });
    const series = option.series as SeriesOption[];
    expect(series.map((item) => item.name)).toEqual([
      'Attention',
      'Dense GEMM',
      'attn.decode',
      'ffn.gemm',
    ]);
    expect(series.map((item) => (item as { data: number[] }).data)).toEqual([
      [80, 0],
      [20, 0],
      [0, 80],
      [0, 20],
    ]);

    const tooltip = (option.tooltip as TooltipComponentOption).formatter;
    expect(typeof tooltip).toBe('function');
    expect((tooltip as (value: unknown) => string)({ seriesIndex: 2, value: 80 })).toBe(
      'attn.decode\nkernel position\n80.00%\n8 ms',
    );
    expect((tooltip as (value: unknown) => string)({ seriesIndex: 2, value: 0 })).toBe('');

    const label = (series[2] as { label: { formatter: (value: unknown) => string } }).label
      .formatter;
    expect(label({ value: 80 })).toBe('decode\n80.0%');
    expect(label({ value: 0 })).toBe('');
  });
});
