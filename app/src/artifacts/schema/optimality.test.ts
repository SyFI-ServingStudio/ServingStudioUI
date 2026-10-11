/**
 * The R4a achievable-limit rung and its kernel gap, as the optimality decoder
 * reads them.
 *
 * The analyzer splits the old R4-R5 hardware gap at R4a (the best measured GEMM
 * or large copy): `kernel_gap = R4 - R4a` and `hardware_gap = R4a - R5`. The
 * buckets must still reconcile with the bar total. Payloads analyzed before the rung existed carry
 * neither key; they read as R4a = R4 with a zero kernel gap rather than as
 * incompatible.
 */
import { describe, expect, it } from 'vitest';

import {
  decodeAnalyzerV1IterationOptimalityKernelLadder,
  decodeAnalyzerV1IterationOptimalityWaterfall,
} from './optimality';

const WORKER = { poolTag: 'main', workerId: '0' };

const META = {
  gpu_name: 'NVIDIA B200',
  gpu_spec_matched: 'B200-SXM-180GB',
  peaks_source: 'generated',
};

function waterfall(buckets: Record<string, number>) {
  return {
    schema_version: 1,
    unit: 'gpu_seconds',
    worker: { pool_tag: 'main', worker_id: 0 },
    iter_id: 7,
    level: {
      level: 'iteration',
      key: 'main/0/7',
      label: 'main/0 iter 7',
      total: 10,
      buckets,
      optimality_ratio: 0.4,
    },
    meta: META,
  };
}

function ladder(rungs: Record<string, number>, kernelRungs: Record<string, number>[]) {
  return {
    schema_version: 1,
    unit: 'gpu_seconds',
    worker: { pool_tag: 'main', worker_id: 0 },
    iter_id: 7,
    rungs: { real: 10, busy: 10, ...rungs },
    special_chunks: { idle: 0, imbalance: 10 - rungs.balanced },
    kernels: kernelRungs.map((kernelRung, index) => ({
      name: `model.k${index}`,
      kind: 'single_gemm',
      is_comm: false,
      rungs: kernelRung,
    })),
    meta: { ...META, gpu_count: 1, folded_rows: 1 },
  };
}

const BASE_BUCKETS = { idle: 0, imbalance: 1, batching: 2, communication: 1 };

describe('optimality kernel gap', () => {
  it('reconciles a waterfall whose hardware gap is split at R4a', () => {
    const decoded = decodeAnalyzerV1IterationOptimalityWaterfall(
      waterfall({ ...BASE_BUCKETS, kernel_gap: 1.5, hardware_gap: 0.5, hardware_optimal: 4 }),
      WORKER,
      '7',
    );
    expect(decoded.level.buckets.kernelGap).toBe(1.5);
    expect(decoded.level.buckets.hardwareGap).toBe(0.5);
  });

  it('rejects a waterfall that drops the kernel gap from its sum', () => {
    expect(() =>
      decodeAnalyzerV1IterationOptimalityWaterfall(
        waterfall({ ...BASE_BUCKETS, kernel_gap: 3, hardware_gap: 0.5, hardware_optimal: 4 }),
        WORKER,
        '7',
      ),
    ).toThrow(/reconcile/);
  });

  it('reads a waterfall analyzed before R4a as a zero kernel gap', () => {
    const decoded = decodeAnalyzerV1IterationOptimalityWaterfall(
      waterfall({ ...BASE_BUCKETS, hardware_gap: 2, hardware_optimal: 4 }),
      WORKER,
      '7',
    );
    expect(decoded.level.buckets.kernelGap).toBe(0);
    expect(decoded.level.buckets.hardwareGap).toBe(2);
  });

  it('carries the scope and per-kernel R4a', () => {
    const scope = {
      balanced: 9,
      per_config_best: 7,
      ignore_network: 6,
      achievable_limit: 4.5,
      hardware_limit: 4,
    };
    const kernels = [
      {
        balanced: 6,
        per_config_best: 5,
        ignore_network: 4,
        achievable_limit: 3,
        hardware_limit: 2.5,
      },
      {
        balanced: 3,
        per_config_best: 2,
        ignore_network: 2,
        achievable_limit: 1.5,
        hardware_limit: 1.5,
      },
    ];
    const decoded = decodeAnalyzerV1IterationOptimalityKernelLadder(
      ladder(scope, kernels),
      WORKER,
      '7',
    );
    expect(decoded.rungs.achievableLimit).toBe(4.5);
    expect(decoded.kernels.map((kernel) => kernel.rungs.achievableLimit)).toEqual([3, 1.5]);
  });

  it('reads a ladder analyzed before R4a as R4a = R4', () => {
    const decoded = decodeAnalyzerV1IterationOptimalityKernelLadder(
      ladder({ balanced: 9, per_config_best: 7, ignore_network: 6, hardware_limit: 4 }, [
        { balanced: 9, per_config_best: 7, ignore_network: 6, hardware_limit: 4 },
      ]),
      WORKER,
      '7',
    );
    expect(decoded.rungs.achievableLimit).toBe(6);
    expect(decoded.kernels[0].rungs.achievableLimit).toBe(6);
  });
});
