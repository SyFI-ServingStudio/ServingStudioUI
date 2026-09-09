import { describe, expect, it } from 'vitest';

import {
  decodeAnalyzerV1IterationOptimalityKernelLadder,
  decodeAnalyzerV1IterationOptimalityWaterfall,
  decodeAnalyzerV1OptimalityPayload,
} from './optimality';

type Buckets = {
  idle: number;
  imbalance: number;
  batching: number;
  communication: number;
  hardware_gap: number;
  hardware_optimal: number;
};

/** Buckets that telescope to `total`, so a level always reconciles by default. */
function buckets(overrides: Partial<Buckets> = {}): Buckets {
  return {
    idle: 0,
    imbalance: 0,
    batching: 0,
    communication: 0,
    hardware_gap: 0,
    hardware_optimal: 0,
    ...overrides,
  };
}

function clusterLevel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    level: 'cluster',
    key: 'cluster',
    label: 'Cluster',
    total: 100,
    optimality_ratio: 0.4,
    buckets: buckets({ idle: 30, hardware_gap: 30, hardware_optimal: 40 }),
    ...overrides,
  };
}

function readyPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    available: true,
    unit: 'gpu_seconds',
    optimality_ratio: 0.4,
    meta: {
      log_dir: 'logs/test',
      gpu_name: 'NVIDIA H200',
      gpu_spec_matched: 'H200-SXM-141GB',
      peaks_source: 'generated',
    },
    levels: [clusterLevel()],
    kernels: [],
    ...overrides,
  };
}

describe('decodeAnalyzerV1OptimalityPayload', () => {
  it('maps a ready payload to camelCase with telescoping buckets intact', () => {
    const result = decodeAnalyzerV1OptimalityPayload(readyPayload());

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.unit).toBe('gpu_seconds');
    expect(result.payload.optimalityRatio).toBeCloseTo(0.4);
    expect(result.payload.necessaryRatio).toBeNull();
    expect(result.payload.gpuName).toBe('NVIDIA H200');
    expect(result.payload.gpuSpecMatched).toBe('H200-SXM-141GB');
    expect(result.payload.peaksSource).toBe('generated');
    expect(result.payload.levels).toHaveLength(1);
    const level = result.payload.levels[0];
    expect(level.buckets.hardwareGap).toBe(30);
    expect(level.buckets.hardwareOptimal).toBe(40);
    expect(level.necessaryRatio).toBeNull();
    expect(level.buckets.idle).toBe(30);
    expect(result.payload.kernels).toEqual([]);
  });

  it('accepts and maps the unlocked global necessary-work split', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        necessary_ratio: 0.2,
        levels: [
          clusterLevel({
            necessary_ratio: 0.2,
            buckets: {
              idle: 30,
              imbalance: 0,
              batching: 0,
              communication: 0,
              hardware_gap: 30,
              excess_over_necessary: 10,
              fusion: 10,
              hardware_necessary: 20,
            },
          }),
        ],
      }),
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.necessaryRatio).toBe(0.2);
    expect(result.payload.levels[0].necessaryRatio).toBe(0.2);
    expect(result.payload.levels[0].buckets).toMatchObject({
      hardwareOptimal: 0,
      excessOverNecessary: 10,
      fusion: 10,
      scopeFusedNecessary: 20,
    });
  });

  it('defaults an absent kernels array and maps kernel buckets to camelCase', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        kernels: [
          {
            name: 'afd.attn.decode',
            kind: 'flashinfer_attn_decode',
            is_comm: false,
            real: 44,
            buckets: {
              batching: 0,
              communication: 0,
              hardware_gap: 20,
              hardware_optimal: 24,
            },
          },
        ],
      }),
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.kernels).toHaveLength(1);
    const kernel = result.payload.kernels[0];
    expect(kernel.isComm).toBe(false);
    expect(kernel.buckets.hardwareGap).toBe(20);
    expect(kernel.buckets.hardwareOptimal).toBe(24);
  });

  it('maps worker kernel ladders and exact iteration identity', () => {
    const workerLadder = {
      key: 'attn/0',
      label: 'attn/0',
      pool_tag: 'attn',
      worker_id: 0,
      rungs: {
        real: 12,
        busy: 10,
        balanced: 8,
        per_config_best: 6,
        ignore_network: 5,
        hardware_limit: 4,
      },
      special_chunks: { idle: 2, imbalance: 2 },
      kernels: [
        {
          name: 'model.gemm',
          kind: 'single_gemm',
          is_comm: false,
          rungs: {
            balanced: 8,
            per_config_best: 6,
            ignore_network: 5,
            hardware_limit: 4,
          },
        },
      ],
    };
    const aggregate = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        worker_kernel_ladders: [workerLadder],
        aggregate_kernel_ladders: [
          {
            level: 'cluster',
            key: 'cluster',
            label: 'Cluster aggregate',
            rungs: workerLadder.rungs,
            special_chunks: workerLadder.special_chunks,
            kernels: workerLadder.kernels,
          },
        ],
      }),
    );
    expect(aggregate.status).toBe('ready');
    if (aggregate.status !== 'ready') return;
    expect(aggregate.payload.workerKernelLadders[0].rungs.perConfigBest).toBe(6);
    expect(aggregate.payload.aggregateKernelLadders[0]).toMatchObject({
      level: 'cluster',
      key: 'cluster',
    });

    const exact = decodeAnalyzerV1IterationOptimalityKernelLadder(
      {
        schema_version: 1,
        unit: 'gpu_seconds',
        worker: { pool_tag: 'attn', worker_id: 0 },
        iter_id: 17,
        rungs: {
          ...workerLadder.rungs,
          real: 10,
          segmented_necessary: 3,
          hardware_necessary: 2,
        },
        special_chunks: { idle: 0, imbalance: 2, fusion: 1 },
        kernels: [
          {
            ...workerLadder.kernels[0],
            rungs: { ...workerLadder.kernels[0].rungs, necessary_limit: 3 },
            necessary_work: {
              semantics: ['gemm'],
              min_flops: 3e12,
              min_bytes: 2e9,
              compute_gpu_s: 3,
              memory_gpu_s: 1,
              necessary_gpu_s: 3,
              wall_s: 3,
              redundant_gpu_s: 1,
              under_accounted_gpu_s: 0,
              bound: 'compute',
            },
          },
        ],
        meta: {
          gpu_name: 'NVIDIA H200',
          gpu_spec_matched: 'H200-SXM-141GB',
          peaks_source: 'sidecar',
          gpu_count: 1,
          folded_rows: 2,
          necessary_work_mode: 'replicated_large_batch',
          necessary_work_replication_factor: 10000,
        },
      },
      { poolTag: 'attn', workerId: '0' },
      '17',
    );
    expect(exact.iterId).toBe('17');
    expect(exact.label).toContain('10000× large-batch');
    expect(exact.necessaryWorkMode).toBe('replicated_large_batch');
    expect(exact.necessaryWorkReplicationFactor).toBe(10000);
    expect(exact.specialChunks.idle).toBe(0);
    expect(exact.rungs.segmentedNecessary).toBe(3);
    expect(exact.rungs.scopeFusedNecessary).toBe(2);
    expect(exact.kernels[0].necessaryWork).toMatchObject({
      semantics: ['gemm'],
      necessaryGpuSeconds: 3,
      bound: 'compute',
    });

    const waterfall = decodeAnalyzerV1IterationOptimalityWaterfall(
      {
        schema_version: 1,
        unit: 'gpu_seconds',
        worker: { pool_tag: 'attn', worker_id: 0 },
        iter_id: 17,
        level: {
          level: 'iteration',
          key: 'attn/0/17',
          label: 'attn/0 / iter 17',
          total: 10,
          buckets: {
            idle: 0,
            imbalance: 2,
            batching: 2,
            communication: 1,
            hardware_gap: 1,
            excess_over_necessary: 1,
            fusion: 1,
            hardware_necessary: 2,
          },
          optimality_ratio: 0.4,
          necessary_ratio: 0.2,
        },
        meta: {
          gpu_name: 'NVIDIA H200',
          gpu_spec_matched: 'H200-SXM-141GB',
          peaks_source: 'batch_locked',
          necessary_work_mode: 'batch_locked',
          necessary_work_replication_factor: 1,
        },
      },
      { poolTag: 'attn', workerId: '0' },
      '17',
    );
    expect(waterfall.level.buckets.scopeFusedNecessary).toBe(2);
    expect(waterfall.level.necessaryRatio).toBe(0.2);
    expect(waterfall.level.label).toContain('fixed batch');
    expect(waterfall.necessaryWorkMode).toBe('batch_locked');
    expect(waterfall.necessaryWorkReplicationFactor).toBe(1);
  });

  it('accepts aggregate necessary work without a non-additive wall time', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        aggregate_kernel_ladders: [
          {
            level: 'cluster',
            key: 'cluster',
            label: 'Cluster aggregate',
            rungs: {
              real: 12,
              busy: 10,
              balanced: 8,
              per_config_best: 6,
              ignore_network: 5,
              hardware_limit: 4,
              segmented_necessary: 3,
              hardware_necessary: 2,
            },
            special_chunks: { idle: 2, imbalance: 2, fusion: 1 },
            kernels: [
              {
                name: 'model.gemm',
                kind: 'single_gemm',
                is_comm: false,
                rungs: {
                  balanced: 8,
                  per_config_best: 6,
                  ignore_network: 5,
                  hardware_limit: 4,
                  necessary_limit: 3,
                },
                necessary_work: {
                  semantics: ['gemm'],
                  min_flops: 3e12,
                  min_bytes: 2e9,
                  compute_gpu_s: 3,
                  memory_gpu_s: 1,
                  necessary_gpu_s: 3,
                  redundant_gpu_s: 1,
                  under_accounted_gpu_s: 0,
                  bound: 'compute',
                },
              },
            ],
          },
        ],
      }),
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(
      result.payload.aggregateKernelLadders[0].kernels[0].necessaryWork?.wallSeconds,
    ).toBeNull();
  });

  it('clamps a fractionally-negative bucket (analyzer clamp artifact) to zero', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        levels: [
          clusterLevel({
            buckets: buckets({
              idle: 30.0000001,
              imbalance: -1e-9,
              hardware_gap: 30,
              hardware_optimal: 40,
            }),
          }),
        ],
      }),
    );

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.levels[0].buckets.imbalance).toBe(0);
  });

  it('rejects a payload whose buckets do not reconcile with the level total', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({
        levels: [clusterLevel({ buckets: buckets({ idle: 10, hardware_optimal: 40 }) })],
      }),
    );

    expect(result.status).toBe('incompatible');
    if (result.status !== 'incompatible') return;
    expect(result.reason).toMatch(/does not reconcile with total/);
  });

  it('rejects duplicate level identities', () => {
    const result = decodeAnalyzerV1OptimalityPayload(
      readyPayload({ levels: [clusterLevel(), clusterLevel()] }),
    );

    expect(result.status).toBe('incompatible');
  });

  it('maps an unavailable payload to its reason', () => {
    const result = decodeAnalyzerV1OptimalityPayload({
      schema_version: 1,
      meta: {
        log_dir: 'logs/test',
        available: false,
        reason: 'cost_log has no (pool_tag, worker_id) rows',
      },
      levels: [],
      kernels: [],
    });

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toMatch(/no \(pool_tag, worker_id\)/);
  });
});
