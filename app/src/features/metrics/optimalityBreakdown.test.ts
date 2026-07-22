import { describe, expect, it } from 'vitest';

import type {
  Optimality,
  OptimalityBuckets,
  OptimalityKernel,
  OptimalityLevel,
} from '../../domain/optimality';
import type { SubjectResult } from '../../domain/subject';
import { makeWorkerKey } from '../../domain/worker';
import {
  hasReportableKernels,
  hasReportableOptimality,
  projectOptimalityBreakdown,
  projectOptimalityKernels,
} from './optimalityBreakdown';

function levelBuckets(overrides: Partial<OptimalityBuckets> = {}): OptimalityBuckets {
  return {
    idle: 0,
    imbalance: 0,
    batching: 0,
    communication: 0,
    hardwareGap: 0,
    hardwareOptimal: 0,
    excessOverNecessary: 0,
    fusion: 0,
    hardwareNecessary: 0,
    ...overrides,
  };
}

function level(
  kind: OptimalityLevel['level'],
  key: string,
  total: number,
  buckets: OptimalityBuckets,
): OptimalityLevel {
  return {
    level: kind,
    key,
    label: key,
    total,
    buckets,
    optimalityRatio: 0.4,
    necessaryRatio: null,
  };
}

function kernel(name: string, real: number): OptimalityKernel {
  return {
    name,
    kind: 'single_gemm',
    isComm: false,
    real,
    buckets: {
      batching: 0,
      communication: 0,
      hardwareGap: real * 0.5,
      hardwareOptimal: real * 0.5,
    },
  };
}

function readySubject(overrides: Partial<Optimality> = {}): SubjectResult<'optimality'> {
  const payload: Optimality = {
    unit: 'gpu_seconds',
    optimalityRatio: 0.4,
    necessaryRatio: null,
    gpuName: 'NVIDIA H200',
    gpuSpecMatched: 'H200-SXM-141GB',
    peaksSource: 'generated',
    levels: [
      level('cluster', 'cluster', 100, levelBuckets({ idle: 60, hardwareOptimal: 40 })),
      level('pool', 'attn', 60, levelBuckets({ idle: 40, hardwareOptimal: 20 })),
      level('pool', 'ffn', 40, levelBuckets({ idle: 20, hardwareOptimal: 20 })),
      level('worker', 'attn/0', 30, levelBuckets({ idle: 20, hardwareOptimal: 10 })),
      level('worker', 'attn/1', 30, levelBuckets({ idle: 20, hardwareOptimal: 10 })),
      level('worker', 'ffn/0', 40, levelBuckets({ idle: 20, hardwareOptimal: 20 })),
      level('iteration', 'iteration', 1, levelBuckets({ hardwareOptimal: 1 })),
    ],
    kernels: [kernel('afd.attn.decode', 44), kernel('afd.ffn.gemm', 20)],
    workerKernelLadders: [],
    aggregateKernelLadders: [],
    ...overrides,
  };
  return { subject: 'optimality', status: 'ready', schemaVersion: 1, payload };
}

describe('projectOptimalityBreakdown', () => {
  it('cluster scope shows the cluster bar plus every pool bar', () => {
    const projection = projectOptimalityBreakdown(readySubject(), { kind: 'cluster' });

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.map((row) => row.label)).toEqual(['cluster', 'attn', 'ffn']);
    expect(projection.optimalityRatio).toBeCloseTo(0.4);
    expect(projection.gpuSpecMatched).toBe('H200-SXM-141GB');
    expect(projection.peaksSource).toBe('generated');
  });

  it('pool scope shows the pool bar plus only its own workers', () => {
    const projection = projectOptimalityBreakdown(readySubject(), {
      kind: 'pool',
      poolTag: 'attn',
    });

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.map((row) => row.label)).toEqual(['attn', 'attn/0', 'attn/1']);
  });

  it('worker scope shows only that worker bar', () => {
    const projection = projectOptimalityBreakdown(readySubject(), {
      kind: 'worker',
      workerKey: makeWorkerKey('attn', 0),
    });

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.map((row) => row.label)).toEqual(['attn/0']);
  });

  it('reports scope_missing for a pool that is absent from the payload', () => {
    const projection = projectOptimalityBreakdown(readySubject(), {
      kind: 'pool',
      poolTag: 'router',
    });

    expect(projection.status).toBe('scope_missing');
    if (projection.status !== 'scope_missing') return;
    expect(projection.reason).toMatch(/pool named router/);
  });

  it('passes through a non-ready subject verbatim', () => {
    const projection = projectOptimalityBreakdown(
      { subject: 'optimality', status: 'not_generated', reason: 'Not logged.' },
      { kind: 'cluster' },
    );
    expect(projection.status).toBe('not_generated');
  });

  it('treats an all-zero scope as not reportable', () => {
    const zeroed = readySubject({
      levels: [level('cluster', 'cluster', 0, levelBuckets())],
    });
    const projection = projectOptimalityBreakdown(zeroed, { kind: 'cluster' });
    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(hasReportableOptimality(projection)).toBe(false);
  });
});

describe('projectOptimalityKernels', () => {
  it('maps each kernel to a stack row keyed by its Real GPU·s', () => {
    const projection = projectOptimalityKernels(readySubject());

    expect(projection.status).toBe('ready');
    if (projection.status !== 'ready') return;
    expect(projection.rows.map((row) => row.label)).toEqual(['afd.attn.decode', 'afd.ffn.gemm']);
    expect(projection.rows[0].total).toBe(44);
    expect(hasReportableKernels(projection)).toBe(true);
  });

  it('reports scope_missing when no per-kernel breakdown is present', () => {
    const projection = projectOptimalityKernels(readySubject({ kernels: [] }));
    expect(projection.status).toBe('scope_missing');
  });
});
