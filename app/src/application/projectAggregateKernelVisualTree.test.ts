import { describe, expect, it } from 'vitest';

import type { AggregateWorkerKernelComposition } from '../domain/kernelTimeShare';
import { makeWorkerKey, makeWorkerRef } from '../domain/worker';
import { projectAggregateKernelVisualTree } from './projectAggregateKernelVisualTree';
import { leafByName } from '../domain/cost-tree';

function composition(
  segments: AggregateWorkerKernelComposition['segments'],
): AggregateWorkerKernelComposition {
  const ref = makeWorkerRef('attn', 0);
  return {
    ref,
    key: makeWorkerKey(ref),
    rawRows: 2,
    sampledRows: 2,
    sampleStride: 1,
    kernelTimeMs: segments.reduce((total, segment) => total + segment.kernelTimeMs, 0),
    segments,
  };
}

describe('aggregate worker kernel projection', () => {
  it('keeps aggregate evidence explicit beside its visual tree', () => {
    const projection = projectAggregateKernelVisualTree(
      composition([
        {
          position: 'attn.decode',
          kind: 'flashinfer_attn_decode',
          kernelTimeMs: 2,
          sharePct: 200 / 3,
        },
        { position: 'attn.out', kind: 'single_gemm', kernelTimeMs: 1, sharePct: 100 / 3 },
      ]),
    );

    expect(projection).toMatchObject({
      evidence: 'aggregate-kernel-composition',
      worker: { poolTag: 'attn', workerId: '0' },
      tree: { kind: 'sum', totalMs: 3 },
    });
    if (projection === null) throw new Error('Expected an aggregate projection.');
    expect(leafByName(projection.tree, 'attn.decode')?.slot.kind).toBe('flashinfer_attn_decode');
  });

  it('does not invent an invalid empty Sum for a zero-time worker', () => {
    expect(projectAggregateKernelVisualTree(composition([]))).toBeNull();
    expect(
      projectAggregateKernelVisualTree(
        composition([
          {
            position: 'zero',
            kind: 'single_gemm',
            kernelTimeMs: 0,
            sharePct: 0,
          },
        ]),
      ),
    ).toBeNull();
  });
});
