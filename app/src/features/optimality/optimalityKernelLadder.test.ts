import { describe, expect, it } from 'vitest';

import type {
  Optimality,
  OptimalityAggregateKernelLadder,
  OptimalityKernelLadder,
} from '../../domain/optimality';
import type { SubjectResult } from '../../domain/subject';
import { makeWorkerKey } from '../../domain/worker';
import {
  projectScopedKernelLadder,
  projectExactKernelLadder,
  projectKernelHeadroom,
} from './optimalityKernelLadder';

function ladder(poolTag: string, workerId: string, scale: number): OptimalityKernelLadder {
  return {
    worker: { poolTag, workerId },
    iterId: null,
    label: `${poolTag}/${workerId}`,
    rungs: {
      real: 12 * scale,
      busy: 10 * scale,
      balanced: 8 * scale,
      perConfigBest: 6 * scale,
      ignoreNetwork: 5 * scale,
      hardwareLimit: 4 * scale,
    },
    specialChunks: { idle: 2 * scale, imbalance: 2 * scale },
    kernels: [
      {
        name: 'model.gemm',
        kind: 'single_gemm',
        isComm: false,
        rungs: {
          balanced: 6 * scale,
          perConfigBest: 4 * scale,
          ignoreNetwork: 4 * scale,
          hardwareLimit: 3 * scale,
        },
      },
      {
        name: 'model.all_reduce',
        kind: 'all_reduce',
        isComm: true,
        rungs: {
          balanced: 2 * scale,
          perConfigBest: 2 * scale,
          ignoreNetwork: 1 * scale,
          hardwareLimit: 1 * scale,
        },
      },
    ],
  };
}

function aggregateLadder(
  level: 'cluster' | 'pool',
  key: string,
  scale: number,
): OptimalityAggregateKernelLadder {
  const source = ladder(key, 'aggregate', scale);
  return {
    level,
    key,
    label: `${key} aggregate`,
    rungs: source.rungs,
    specialChunks: source.specialChunks,
    kernels: source.kernels,
  };
}

function subject(
  ladders: OptimalityKernelLadder[],
  aggregates: OptimalityAggregateKernelLadder[] = [],
): SubjectResult<'optimality'> {
  const payload: Optimality = {
    unit: 'gpu_seconds',
    optimalityRatio: 0.4,
    necessaryRatio: null,
    levels: [],
    kernels: [],
    workerKernelLadders: ladders,
    aggregateKernelLadders: aggregates,
    gpuName: 'NVIDIA H200',
    gpuSpecMatched: 'H200-SXM-141GB',
    peaksSource: 'sidecar',
  };
  return { subject: 'optimality', status: 'ready', schemaVersion: 1, payload };
}

describe('optimality kernel ladder projection', () => {
  it('selects analyzer-owned cluster and pool ladders without UI aggregation', () => {
    const ready = subject(
      [ladder('attn', '0', 1), ladder('attn', '1', 2), ladder('ffn', '0', 4)],
      [aggregateLadder('cluster', 'cluster', 7), aggregateLadder('pool', 'attn', 3)],
    );
    const cluster = projectScopedKernelLadder(ready, { kind: 'cluster' });
    const pool = projectScopedKernelLadder(ready, { kind: 'pool', poolTag: 'attn' });
    expect(cluster.status).toBe('ready');
    expect(pool.status).toBe('ready');
    if (cluster.status !== 'ready' || pool.status !== 'ready') return;
    expect(cluster.rows.map((row) => row.total)).toEqual([84, 70, 56, 42, 35, 28]);
    expect(pool.rows.map((row) => row.total)).toEqual([36, 30, 24, 18, 15, 12]);
  });

  it('selects one worker by composite key', () => {
    const projection = projectScopedKernelLadder(
      subject([ladder('attn', '0', 1), ladder('ffn', '0', 4)]),
      { kind: 'worker', workerKey: makeWorkerKey('ffn', '0') },
    );
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows[0].total).toBe(48);
  });

  it('filters an exact iteration ladder to one kernel without assigning special chunks', () => {
    const exact = { ...ladder('attn', '0', 1), iterId: '17' };
    const projection = projectExactKernelLadder(exact, 'model.gemm');
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.kernelNames).toEqual(['model.gemm']);
    expect(projection.rows.map((row) => row.total)).toEqual([6, 6, 6, 4, 4, 3]);
    expect(projection.rows[0].values.__idle).toBeUndefined();
    expect(projection.rows[1].values.__imbalance).toBeUndefined();

    const headroom = projectKernelHeadroom(projection);
    expect(headroom.status).toBe('ready');
    if (headroom.status !== 'ready') return;
    expect(headroom.rows).toEqual([
      {
        label: 'model.gemm',
        total: 6,
        values: {
          batching: 2,
          communication: 0,
          hardwareGap: 1,
          hardwareOptimal: 3,
        },
      },
    ]);
  });

  it('adds mapped R6 and splits R5 while retaining an under-accounted marker', () => {
    const exact = ladder('attn', '0', 1);
    exact.iterId = '17';
    exact.rungs.segmentedNecessary = 5;
    exact.rungs.scopeFusedNecessary = 2;
    exact.specialChunks.fusion = 3;
    exact.kernels = [
      {
        ...exact.kernels[0],
        rungs: { ...exact.kernels[0].rungs, necessaryLimit: 5 },
        necessaryWork: {
          semantics: ['gemm'],
          minFlops: 5e12,
          minBytes: 1e9,
          computeGpuSeconds: 5,
          memoryGpuSeconds: 1,
          necessaryGpuSeconds: 5,
          wallSeconds: 5,
          redundantGpuSeconds: 0,
          underAccountedGpuSeconds: 2,
          underAccountedRawGpuSeconds: 2,
          accountingToleranceGpuSeconds: 0.025,
          bound: 'compute',
        },
      },
    ];
    const projection = projectExactKernelLadder(exact);
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.at(-2)).toMatchObject({ label: 'R6 Segmented necessary', total: 5 });
    expect(projection.rows.at(-1)).toMatchObject({ label: 'R7 Scope fused', total: 2 });

    const headroom = projectKernelHeadroom(projection);
    expect(headroom.status).toBe('ready');
    if (headroom.status !== 'ready') return;
    expect(headroom.underAccountedKernelCount).toBe(1);
    expect(headroom.rows[0]).toMatchObject({
      marker: 5,
      values: { necessaryCovered: 3, redundant: 0 },
    });

    const selectedKernel = projectExactKernelLadder(exact, 'model.gemm');
    expect(selectedKernel.status).toBe('ready');
    if (selectedKernel.status !== 'ready') return;
    expect(selectedKernel.rows.at(-1)).toMatchObject({
      label: 'R6 Segmented necessary',
      total: 5,
    });
    expect(selectedKernel.rows.some((row) => row.label === 'R7 Scope fused')).toBe(false);
  });

  it('derives scoped recoverable-source bars and collapses locations below the top 16', () => {
    const manyKernels = Array.from({ length: 18 }, (_, index) => {
      const balanced = 100 - index;
      return {
        name: `model.kernel_${index.toString().padStart(2, '0')}`,
        kind: 'single_gemm',
        isComm: false,
        rungs: {
          balanced,
          perConfigBest: balanced - 4,
          ignoreNetwork: balanced - 6,
          hardwareLimit: balanced - 9,
        },
      };
    });
    const aggregateSource = aggregateLadder('cluster', 'cluster', 1);
    const aggregate = projectScopedKernelLadder(
      subject(
        [],
        [
          {
            ...aggregateSource,
            kernels: manyKernels,
          },
        ],
      ),
      { kind: 'cluster' },
    );
    const headroom = projectKernelHeadroom(aggregate);

    expect(headroom.status).toBe('ready');
    if (headroom.status !== 'ready') return;
    expect(headroom.rows).toHaveLength(17);
    expect(headroom.collapsedKernelCount).toBe(2);
    expect(headroom.rows[0]).toMatchObject({
      label: 'model.kernel_00',
      total: 100,
      values: { batching: 4, communication: 2, hardwareGap: 3, hardwareOptimal: 91 },
    });
    expect(headroom.rows.at(-1)).toMatchObject({
      label: 'other',
      total: 167,
      values: { batching: 8, communication: 4, hardwareGap: 6, hardwareOptimal: 149 },
    });
    expect(headroom.rows.at(-1)?.values).not.toHaveProperty('necessaryCovered');
    expect(headroom.rows.at(-1)?.values).not.toHaveProperty('redundant');
  });
});
