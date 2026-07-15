import { describe, expect, it } from 'vitest';

import kernelTimeShareJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_time_share_composition.json';
import { makeWorkerKey } from '../../../domain/worker';
import { decodeAnalyzerV1KernelTimeSharePayload } from './kernelTimeShare';

interface MutableKernelTimeFixture extends Record<string, unknown> {
  meta: Record<string, unknown>;
  overall: { segments: Array<Record<string, unknown>> };
  workers: Array<Record<string, unknown>>;
}

function mutableFixture(): MutableKernelTimeFixture {
  return structuredClone(kernelTimeShareJson) as MutableKernelTimeFixture;
}

function minimalReadyPayload(activeTimeMs = 10): Record<string, unknown> {
  const activeSegment = () => ({
    position: 'model.kernel',
    kind: 'single_gemm',
    kernel_time_ms: activeTimeMs,
    share_pct: 100,
  });
  return {
    schema_version: 1,
    available: true,
    meta: {
      log_dir: 'logs/test',
      exact: true,
      sampling_method: 'all rows',
      max_replay_rows_target: 10,
      raw_rows: 1,
      sampled_rows: 1,
      num_positions: 1,
      num_pools: 2,
      num_workers: 2,
      tree_cache_hits: 0,
      tree_cache_misses: 1,
      kernel_time_totals_exact: true,
    },
    overall: {
      kernel_time_ms: activeTimeMs,
      segments: [activeSegment()],
    },
    pools: [
      { pool_tag: 'idle', num_workers: 1, kernel_time_ms: 0, segments: [] },
      {
        pool_tag: 'active',
        num_workers: 1,
        kernel_time_ms: activeTimeMs,
        segments: [activeSegment()],
      },
    ],
    workers: [
      {
        pool_tag: 'idle',
        worker_id: 0,
        raw_rows: 0,
        sampled_rows: 0,
        sample_stride: 1,
        kernel_time_ms: 0,
        segments: [],
      },
      {
        pool_tag: 'active',
        worker_id: 0,
        raw_rows: 1,
        sampled_rows: 1,
        sample_stride: 1,
        kernel_time_ms: activeTimeMs,
        segments: [activeSegment()],
      },
    ],
    positions: [{ name: 'model.kernel', kind: 'single_gemm', overall_share_pct: 100 }],
    definitions: {},
  };
}

describe('decodeAnalyzerV1KernelTimeSharePayload', () => {
  it('maps the real sampled payload without collapsing same-numbered workers', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(kernelTimeShareJson);

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.pools).toHaveLength(2);
    expect(result.payload.workers).toHaveLength(10);
    expect(result.payload.sampling.positionMixExact).toBe(false);
    expect(result.payload.kernelTimeTotalsExact).toBe(true);
    expect(result.payload.workers.map((worker) => worker.key)).toEqual(
      expect.arrayContaining([makeWorkerKey('attn', 0), makeWorkerKey('ffn', 0)]),
    );
  });

  it('preserves an analyzer-declared unavailable reason', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload({
      schema_version: 1,
      available: false,
      meta: { log_dir: 'logs/test', reason: 'cost_log/ dir not found' },
      overall: {},
      pools: [],
      workers: [],
      positions: [],
      definitions: {},
    });

    expect(result).toEqual({
      subject: 'kernelTimeShare',
      status: 'unavailable',
      reason: 'cost_log/ dir not found',
    });
  });

  it('reports unsupported schema versions as incompatible', () => {
    const wire = mutableFixture();
    wire.schema_version = 2;

    expect(decodeAnalyzerV1KernelTimeSharePayload(wire)).toMatchObject({
      subject: 'kernelTimeShare',
      status: 'incompatible',
      receivedSchemaVersion: 2,
      reason: expect.stringContaining('unsupported version 2'),
    });
  });

  it('reports the exact path of a malformed worker identity', () => {
    const wire = mutableFixture();
    delete wire.workers[0].pool_tag;

    expect(decodeAnalyzerV1KernelTimeSharePayload(wire)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('workers.0.pool_tag'),
    });
  });

  it('rejects duplicate composite workers and inconsistent declared counts', () => {
    const wire = mutableFixture();
    wire.workers[1] = structuredClone(wire.workers[0]);
    wire.meta.num_workers = 11;

    const result = decodeAnalyzerV1KernelTimeSharePayload(wire);
    expect(result).toMatchObject({ status: 'incompatible' });
    if (result.status !== 'incompatible') return;
    expect(result.reason).toContain('duplicate composite worker attn/0');
    expect(result.reason).toContain('meta.num_workers');
  });

  it('accepts additive v1 fields without leaking them into the domain object', () => {
    const wire = mutableFixture();
    wire.future_optional = true;
    wire.overall.segments[0].future_optional = 'kept on the wire only';

    const result = decodeAnalyzerV1KernelTimeSharePayload(wire);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload).not.toHaveProperty('future_optional');
    expect(result.payload.overall.segments[0]).not.toHaveProperty('future_optional');
  });

  it('rejects per-segment shares that do not match their kernel-time ratios', () => {
    const wire = mutableFixture();
    const segments = wire.overall.segments as Array<Record<string, number>>;
    segments[0].share_pct += 1;
    segments[1].share_pct -= 1;

    const result = decodeAnalyzerV1KernelTimeSharePayload(wire);
    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('overall.segments.0.share_pct'),
    });
  });

  it('accepts a zero-time worker and pool when the overall scope has work', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(minimalReadyPayload());

    expect(result.status).toBe('ready');
  });

  it('preserves analyzer share semantics for tiny positive kernel times', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(minimalReadyPayload(5e-7));

    expect(result.status).toBe('ready');
  });

  it('rejects tiny kernel-time conservation errors above the analyzer epsilon', () => {
    const wire = minimalReadyPayload(5e-7);
    const overall = wire.overall as { segments: Array<Record<string, number>> };
    overall.segments[0].kernel_time_ms = 0;

    const result = decodeAnalyzerV1KernelTimeSharePayload(wire);
    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('overall.segments'),
    });
  });

  it('can bind a fixture payload to its declared source run', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(kernelTimeShareJson, {
      expectedLogDir: 'logs/a-different-run',
    });

    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.log_dir'),
    });
  });

  it('also binds unavailable payloads to their declared source run', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(
      {
        schema_version: 1,
        available: false,
        meta: { log_dir: 'logs/test', reason: 'cost_log/ dir not found' },
        overall: {},
        pools: [],
        workers: [],
        positions: [],
        definitions: {},
      },
      { expectedLogDir: 'logs/a-different-run' },
    );

    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.log_dir'),
    });
  });

  it('does not normalize a wire source path before provenance validation', () => {
    const result = decodeAnalyzerV1KernelTimeSharePayload(
      {
        schema_version: 1,
        available: false,
        meta: { log_dir: ' logs/test ', reason: 'cost_log/ dir not found' },
        overall: {},
        pools: [],
        workers: [],
        positions: [],
        definitions: {},
      },
      { expectedLogDir: 'logs/test' },
    );

    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('meta.log_dir'),
    });
  });

  it('rejects position mixtures that disagree between worker and pool scopes', () => {
    const wire = mutableFixture();
    const worker = wire.workers[0];
    const segments = worker.segments as Array<Record<string, number>>;
    const total = worker.kernel_time_ms as number;
    segments[0].kernel_time_ms += 1;
    segments[1].kernel_time_ms -= 1;
    segments[0].share_pct = (segments[0].kernel_time_ms / total) * 100;
    segments[1].share_pct = (segments[1].kernel_time_ms / total) * 100;

    const result = decodeAnalyzerV1KernelTimeSharePayload(wire);
    expect(result).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('does not equal its worker total'),
    });
  });
});
