import { describe, expect, it } from 'vitest';

import type { KernelTimeShare, WorkerKernelComposition } from '../../artifacts';
import { projectWorkerComposition } from './composition';

const WORKER = { poolTag: 'attn', workerId: '0' };

function share(overrides: Partial<KernelTimeShare> = {}): KernelTimeShare {
  return {
    overall: {
      kernelTimeMs: 40,
      segments: [
        { position: 'attn.decode', kind: 'flashinfer_attn_decode', kernelTimeMs: 30, sharePct: 75 },
        { position: 'ffn.gemm', kind: 'single_gemm', kernelTimeMs: 10, sharePct: 25 },
      ],
    },
    pools: [],
    workers: [
      {
        worker: WORKER,
        kernelTimeMs: 10,
        sampling: { rawRows: 400, sampledRows: 40, stride: 10 },
      },
      {
        worker: { poolTag: 'attn', workerId: '1' },
        kernelTimeMs: 0,
        sampling: { rawRows: 0, sampledRows: 0, stride: 1 },
      },
    ],
    positions: [],
    sampling: { exact: false, method: 'stride', rawRows: 400, sampledRows: 40, stride: 1 },
    definitions: {},
    ...overrides,
  };
}

function composition(overrides: Partial<WorkerKernelComposition> = {}): WorkerKernelComposition {
  return {
    worker: WORKER,
    kernelTimeMs: 10,
    segments: [
      { position: 'ffn.gemm', kind: 'single_gemm', kernelTimeMs: 2, sharePct: 20 },
      { position: 'attn.decode', kind: 'flashinfer_attn_decode', kernelTimeMs: 6, sharePct: 60 },
      { position: 'attn.append', kind: 'kv_cache_append', kernelTimeMs: 2, sharePct: 20 },
    ],
    sampling: { rawRows: 400, sampledRows: 40, stride: 10 },
    ...overrides,
  };
}

describe('projectWorkerComposition', () => {
  it('orders positions by time and reports the worker share of the whole result', () => {
    const projection = projectWorkerComposition(share(), WORKER, composition());

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.value.slices.map((slice) => slice.position)).toEqual([
      'attn.decode',
      'attn.append',
      'ffn.gemm',
    ]);
    expect(projection.value.kernelTimeMs).toBe(10);
    // 10 ms of the result's 40 ms.
    expect(projection.value.resultSharePct).toBeCloseTo(25, 9);
  });

  it('groups positions into families, largest first', () => {
    // Two attention positions outweigh the single GEMM even though the GEMM
    // position is not the smallest one on its own.
    const projection = projectWorkerComposition(share(), WORKER, composition());

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.value.families.map((family) => [family.family, family.kernelTimeMs])).toEqual(
      [
        ['attn', 8],
        ['gemm', 2],
      ],
    );
    expect(projection.value.families[0].sharePct).toBeCloseTo(80, 9);
  });

  it('files an unrecognized kernel kind under Other rather than refusing to draw', () => {
    // The Analyzer's kernel vocabulary grows independently of this build.
    const projection = projectWorkerComposition(
      share(),
      WORKER,
      composition({
        segments: [
          { position: 'new.thing', kind: 'not_a_known_kind', kernelTimeMs: 10, sharePct: 100 },
        ],
      }),
    );

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.value.families).toHaveLength(1);
    expect(projection.value.families[0]).toMatchObject({ family: 'misc', label: 'Other' });
    // The kind keeps its wire spelling when there is no display name for it.
    expect(projection.value.slices[0].kind).toBe('not_a_known_kind');
  });

  it('distinguishes a worker the result does not have from one it has not read', () => {
    // The first is an answer about the run; the second is a statement about the
    // request, and only the second goes away by fetching something.
    const absent = projectWorkerComposition(share(), { poolTag: 'ffn', workerId: '3' }, undefined);
    const unread = projectWorkerComposition(share(), WORKER, undefined);

    expect(absent).toEqual({
      status: 'absent',
      reason: 'This result has no worker ffn/3.',
    });
    expect(unread).toEqual({ status: 'unread', worker: WORKER });
  });

  it('refuses a composition that belongs to a different worker', () => {
    // Rendering it under the requested name would attribute one worker's kernel
    // time to another, and look entirely normal doing so.
    const other = composition({ worker: { poolTag: 'attn', workerId: '1' } });

    expect(projectWorkerComposition(share(), WORKER, other)).toEqual({
      status: 'unread',
      worker: WORKER,
    });
  });

  it('keeps a zero-time worker ready so the legacy empty chart keeps its metadata', () => {
    const idle = { poolTag: 'attn', workerId: '1' };
    const result = projectWorkerComposition(
      share(),
      idle,
      composition({ worker: idle, kernelTimeMs: 0, segments: [] }),
    );
    expect(result).toMatchObject({
      status: 'ready',
      value: { worker: idle, kernelTimeMs: 0, slices: [] },
    });
  });

  it('drops positions below the analyzer epsilon without changing the card state', () => {
    const projection = projectWorkerComposition(
      share(),
      WORKER,
      composition({
        kernelTimeMs: 5e-13,
        segments: [{ position: 'noise', kind: 'single_gemm', kernelTimeMs: 5e-13, sharePct: 100 }],
      }),
    );

    expect(projection).toMatchObject({ status: 'ready', value: { slices: [] } });
  });

  it('reports the mixture as exact only when every row was replayed', () => {
    const sampled = projectWorkerComposition(share(), WORKER, composition());
    const exact = projectWorkerComposition(
      share(),
      WORKER,
      composition({ sampling: { rawRows: 400, sampledRows: 400, stride: 1 } }),
    );

    expect(sampled).toMatchObject({ status: 'ready', value: { mixtureExact: false } });
    expect(exact).toMatchObject({ status: 'ready', value: { mixtureExact: true } });
  });
});
