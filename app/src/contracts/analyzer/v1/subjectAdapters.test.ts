import { describe, expect, it } from 'vitest';

import batchJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/batch_scatter.json';
import conservationJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/workload_conservation_checks.json';
import kvJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';
import sloJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';
import throughputJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/throughput_segments.json';
import utilizationJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/utilization_series.json';
import { makeWorkerKey } from '../../../domain/worker';
import { decodeAnalyzerV1BatchPayload } from './batch';
import { decodeAnalyzerV1ConservationPayload } from './conservation';
import { decodeAnalyzerV1KvOccupancyPayload } from './kvOccupancy';
import { decodeAnalyzerV1SloPayload } from './slo';
import { decodeAnalyzerV1ThroughputPayload } from './throughput';
import { decodeAnalyzerV1UtilizationPayload } from './utilization';

const SOURCE_LOG_DIR = 'logs/20260715_1_afd_ui_reanalysis';

describe('analyzer-v1 aggregate subject adapters', () => {
  it('maps the real SLO payload and binds its completed-request count', () => {
    const result = decodeAnalyzerV1SloPayload(sloJson, {
      expectedCompletedRequests: 5587,
      expectedLogDir: SOURCE_LOG_DIR,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.ttft.unit).toBe('ms');
    expect(result.payload.tpot.unit).toBe('ms/token');
    expect(result.payload.e2e.markers.p50).toBeGreaterThan(0);
  });

  it('maps per-GPU throughput to cluster rates', () => {
    const result = decodeAnalyzerV1ThroughputPayload(throughputJson, {
      expectedGpuName: 'NVIDIA H200',
      expectedLogDir: SOURCE_LOG_DIR,
      expectedNumGpus: 48,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.total[0]).toBeCloseTo(throughputJson.series[0].per_gpu[0] * 48);
    expect(result.payload.total).toHaveLength(result.payload.t_start_ms.length);
  });

  it('maps pool utilization without clamping analyzer diagnostics', () => {
    const wire = structuredClone(utilizationJson);
    wire.series[0].util[0] = 1.05;

    const result = decodeAnalyzerV1UtilizationPayload(wire, {
      expectedLogDir: SOURCE_LOG_DIR,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.series).toHaveLength(2);
    expect(result.payload.workerSeries).toEqual([]);
    expect(result.payload.series[0].util[0]).toBe(1.05);
  });

  it('maps additive worker utilization with composite worker identity', () => {
    const wire = structuredClone(utilizationJson) as typeof utilizationJson & {
      meta: typeof utilizationJson.meta & { worker_unit: string };
      worker_series: Array<{
        key: string;
        label: string;
        pool_tag: string;
        worker_id: number | string;
        util: number[];
      }>;
    };
    wire.meta.worker_unit = 'fraction of worker/GPU busy time (0-1)';
    wire.worker_series = [
      {
        key: 'worker_0_0',
        label: 'attn/0',
        pool_tag: 'attn',
        worker_id: 0,
        util: [...wire.series[0].util],
      },
      {
        key: 'worker_1_0',
        label: 'ffn/0',
        pool_tag: 'ffn',
        worker_id: '0',
        util: [...wire.series[1].util],
      },
    ];

    const result = decodeAnalyzerV1UtilizationPayload(wire);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.workerSeries).toMatchObject([
      { key: 'attn/0', worker: { poolTag: 'attn', workerId: '0' } },
      { key: 'ffn/0', worker: { poolTag: 'ffn', workerId: '0' } },
    ]);
  });

  it('maps the real KV payload with a stable series key', () => {
    const result = decodeAnalyzerV1KvOccupancyPayload(kvJson, {
      expectedLogDir: SOURCE_LOG_DIR,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.series[0]).toMatchObject({
      key: 'attn/g0',
      poolTag: 'attn',
      capacity: expect.any(Number),
    });
    expect(result.payload.workerSeries).toHaveLength(8);
    expect(result.payload.workerSeries[0]).toMatchObject({
      key: 'attn/0',
      worker: { poolTag: 'attn', workerId: '0' },
      capacity: kvJson.series[0].capacity_tokens,
    });
  });

  it('accepts multiple KV groups in one pool', () => {
    const wire = structuredClone(kvJson);
    const secondSeries = structuredClone(wire.series[0]);
    secondSeries.key = 'attn/g1';
    secondSeries.label = 'attn · g1';
    secondSeries.group_id = 1;
    secondSeries.workers = [];
    wire.series.push(secondSeries);

    const result = decodeAnalyzerV1KvOccupancyPayload(wire);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.series.map((series) => series.key)).toEqual(['attn/g0', 'attn/g1']);
  });

  it('preserves a valid raw-token KV payload without capacity metadata', () => {
    const wire = structuredClone(kvJson) as unknown as {
      meta: { has_capacity: boolean };
      series: Array<{ capacity_tokens: number | null }>;
    };
    wire.meta.has_capacity = false;
    wire.series.forEach((series) => {
      series.capacity_tokens = null;
    });

    const result = decodeAnalyzerV1KvOccupancyPayload(wire);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.series[0].capacity).toBeNull();
  });

  it('accepts the real AFD batch payload without inventing an FFN additive identity', () => {
    const result = decodeAnalyzerV1BatchPayload(batchJson, {
      expectedLogDir: SOURCE_LOG_DIR,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(Object.keys(result.payload.pools)).toEqual(['attn', 'ffn']);
    expect(result.payload.pools.ffn.batchTokens[0]).toBeGreaterThan(
      result.payload.pools.ffn.prefillTokens[0] + result.payload.pools.ffn.decodeRequests[0],
    );
    expect(result.payload.workers).toEqual([]);
  });

  it('maps additive worker batch rows by composite worker identity', () => {
    const wire = structuredClone(batchJson) as typeof batchJson & {
      workers: Array<
        Omit<(typeof batchJson.pools)[number], 'pool'> & { pool_tag: string; worker_id: number }
      >;
    };
    const { pool: _pool, ...composition } = wire.pools[0];
    wire.workers = [{ ...composition, pool_tag: 'attn', worker_id: 0 }];

    const result = decodeAnalyzerV1BatchPayload(wire, { expectedLogDir: SOURCE_LOG_DIR });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.workers[0]).toMatchObject({
      key: makeWorkerKey('attn', '0'),
      worker: { poolTag: 'attn', workerId: '0' },
    });
    expect(result.payload.workers[0].batchTokens).toEqual(composition.series[0].values);
  });

  it('maps workload-conservation checks and their status tokens', () => {
    const result = decodeAnalyzerV1ConservationPayload(conservationJson, {
      expectedLogDir: SOURCE_LOG_DIR,
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.allOk).toBe(true);
    expect(result.payload.checks).toHaveLength(6);
    expect(result.payload.checks.every((check) => check.status === 'ok')).toBe(true);
  });

  it('preserves subject-local unavailable reasons', () => {
    const reason = 'required parquet columns are absent';
    const unavailableMeta = { log_dir: SOURCE_LOG_DIR, available: false as const, reason };

    expect(
      decodeAnalyzerV1SloPayload({ schema_version: 1, meta: unavailableMeta, series: [] }),
    ).toMatchObject({ subject: 'slo', status: 'unavailable', reason });
    expect(
      decodeAnalyzerV1ThroughputPayload({
        schema_version: 1,
        meta: unavailableMeta,
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    ).toMatchObject({ subject: 'throughput', status: 'unavailable', reason });
    expect(
      decodeAnalyzerV1UtilizationPayload({
        schema_version: 1,
        meta: unavailableMeta,
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    ).toMatchObject({ subject: 'utilization', status: 'unavailable', reason });
    expect(
      decodeAnalyzerV1KvOccupancyPayload({
        schema_version: 1,
        meta: unavailableMeta,
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    ).toMatchObject({ subject: 'kv', status: 'unavailable', reason });
    expect(
      decodeAnalyzerV1BatchPayload({ schema_version: 1, meta: unavailableMeta, pools: [] }),
    ).toMatchObject({ subject: 'batch', status: 'unavailable', reason });
    expect(
      decodeAnalyzerV1ConservationPayload({
        schema_version: 1,
        meta: unavailableMeta,
        checks: [],
      }),
    ).toMatchObject({ subject: 'conservation', status: 'unavailable', reason });
  });

  it('reports unsupported payload versions before structural drift', () => {
    const wire = { ...sloJson, schema_version: 2 };

    expect(decodeAnalyzerV1SloPayload(wire)).toMatchObject({
      subject: 'slo',
      status: 'incompatible',
      receivedSchemaVersion: 2,
      reason: expect.stringContaining('unsupported version 2'),
    });
  });

  it('rejects an artifact belonging to another source run', () => {
    expect(
      decodeAnalyzerV1UtilizationPayload(utilizationJson, {
        expectedLogDir: 'logs/a-different-run',
      }),
    ).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.log_dir'),
    });
  });

  it('rejects malformed parallel series and aggregate invariants', () => {
    const badSlo = structuredClone(sloJson);
    badSlo.series[0].y_pct.pop();
    expect(decodeAnalyzerV1SloPayload(badSlo)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('y_pct'),
    });

    const badThroughput = structuredClone(throughputJson);
    badThroughput.series[0].per_gpu[0] += 1;
    expect(decodeAnalyzerV1ThroughputPayload(badThroughput)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('must equal prefill + decode'),
    });

    const badUtilization = structuredClone(utilizationJson);
    badUtilization.series[1].key = badUtilization.series[0].key;
    expect(decodeAnalyzerV1UtilizationPayload(badUtilization)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('duplicate key'),
    });

    const badWorkerUtilization = {
      ...structuredClone(utilizationJson),
      worker_series: [
        {
          key: 'worker_0_0',
          label: 'Worker 0',
          pool_tag: 'attn',
          worker_id: 0,
          util: [...utilizationJson.series[0].util],
        },
        {
          key: 'another-wire-key',
          label: 'Same Worker 0',
          pool_tag: 'attn',
          worker_id: '0',
          util: [...utilizationJson.series[0].util],
        },
      ],
    };
    expect(decodeAnalyzerV1UtilizationPayload(badWorkerUtilization)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('worker_series.worker.1: duplicate key attn/0'),
    });

    const badKv = structuredClone(kvJson);
    badKv.meta.has_capacity = false;
    expect(decodeAnalyzerV1KvOccupancyPayload(badKv)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.has_capacity'),
    });

    const badBatch = structuredClone(batchJson);
    badBatch.pools[0].plotted_points += 1;
    expect(decodeAnalyzerV1BatchPayload(badBatch)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('plotted_points'),
    });

    const badConservation = structuredClone(conservationJson);
    badConservation.meta.all_ok = false;
    expect(decodeAnalyzerV1ConservationPayload(badConservation)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.all_ok'),
    });
  });
});
