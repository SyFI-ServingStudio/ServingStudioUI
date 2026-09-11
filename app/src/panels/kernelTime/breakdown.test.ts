import { describe, expect, it } from 'vitest';

import type { KernelTimeShare } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { poolBreakdown, runBreakdown } from './breakdown';
import { kernelTimeStackOption } from './option';

function segment(position: string, kind: string, kernelTimeMs: number, total: number) {
  return { position, kind, kernelTimeMs, sharePct: (kernelTimeMs / total) * 100 };
}

const SHARE: KernelTimeShare = {
  overall: {
    kernelTimeMs: 100,
    segments: [
      segment('gemm', 'single_gemm', 60, 100),
      segment('attn', 'flashinfer_attn_decode', 40, 100),
    ],
  },
  pools: [
    {
      poolTag: 'prefill',
      numWorkers: 1,
      kernelTimeMs: 30,
      segments: [segment('gemm', 'single_gemm', 30, 30)],
    },
    {
      poolTag: 'decode',
      numWorkers: 1,
      kernelTimeMs: 70,
      segments: [
        segment('attn', 'flashinfer_attn_decode', 40, 70),
        segment('gemm', 'single_gemm', 30, 70),
      ],
    },
  ],
  workers: [
    {
      worker: { poolTag: 'prefill', workerId: '0' },
      kernelTimeMs: 30,
      sampling: { rawRows: 100, sampledRows: 10, stride: 10 },
    },
    {
      worker: { poolTag: 'decode', workerId: '0' },
      kernelTimeMs: 70,
      sampling: { rawRows: 100, sampledRows: 100, stride: 1 },
    },
  ],
  positions: [],
  sampling: {
    exact: false,
    method: 'worker-local regular iter_id stride',
    rawRows: 200,
    sampledRows: 110,
    stride: 10,
  },
  definitions: {},
};

function readyPool(poolTag: string) {
  const result = poolBreakdown(SHARE, poolTag);
  if (result.status !== 'ready') throw new Error(result.reason);
  return result;
}

describe('kernel-time chart projection', () => {
  it('keeps the legacy cluster row followed by pools in wire order', () => {
    const result = runBreakdown(SHARE);
    expect(result.rows.map((row) => row.label)).toEqual(['cluster', 'prefill', 'decode']);
    expect(result.sampling).toEqual({
      method: 'worker-local regular iter_id stride',
      rawRows: 200,
      sampledRows: 110,
    });
    expect(result.positionMixExact).toBe(false);
  });

  it('keeps a pool as one row and scopes its replay accounting', () => {
    const prefill = readyPool('prefill');
    const decode = readyPool('decode');
    expect(prefill.rows.map((row) => row.label)).toEqual(['prefill']);
    expect(prefill.sampling).toMatchObject({ rawRows: 100, sampledRows: 10 });
    expect(prefill.positionMixExact).toBe(false);
    expect(decode.positionMixExact).toBe(true);
  });

  it('orders only families present in the scope by overall weight', () => {
    expect(runBreakdown(SHARE).families.map((family) => family.group)).toEqual(['gemm', 'attn']);
    expect(readyPool('prefill').families.map((family) => family.group)).toEqual(['gemm']);
  });

  it('distinguishes a missing pool from an empty pool', () => {
    expect(poolBreakdown(SHARE, 'missing')).toEqual({
      status: 'absent',
      reason: 'This run has no pool named missing.',
    });
    const empty = {
      ...SHARE,
      pools: [{ poolTag: 'idle', numWorkers: 1, kernelTimeMs: 0, segments: [] }],
      workers: [],
    };
    expect(poolBreakdown(empty, 'idle')).toMatchObject({ status: 'ready', rows: [{ total: 0 }] });
  });

  it('keeps the accepted aggregate chart option', () => {
    const result = runBreakdown(SHARE);
    const current = kernelTimeStackOption(result, CHART_THEME);
    expect(current).toMatchSnapshot();
  });
});
