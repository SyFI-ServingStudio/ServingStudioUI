import { describe, expect, it } from 'vitest';

import kernelThroughputJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/kernel_throughput_locations.json';
import { decodeAnalyzerV1KernelThroughputPayload } from './kernelThroughput';

interface MutableFixture extends Record<string, unknown> {
  definitions: Record<string, unknown>;
  locations: Array<{
    name: string;
    tflops: Record<string, number | null>;
    gbps: Record<string, number | null>;
  }>;
  meta: Record<string, number | string>;
}

function mutableFixture(): MutableFixture {
  return structuredClone(kernelThroughputJson) as MutableFixture;
}

describe('decodeAnalyzerV1KernelThroughputPayload', () => {
  it('maps the real AFD payload and preserves empty compute statistics', () => {
    const result = decodeAnalyzerV1KernelThroughputPayload(kernelThroughputJson, {
      expectedLogDir: 'logs/20260715_1_afd_ui_reanalysis',
    });

    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload.locations).toHaveLength(18);
    expect(result.payload.units).toEqual({ tflops: 'TFLOP/s', gbps: 'GB/s' });
    expect(result.payload.sampling).toEqual({
      stride: 50,
      sampledRows: 992_608,
      sampledComputeSlots: 3_780_754,
      sampledMemorySlots: 5_451_433,
    });
    const embedding = result.payload.locations.find(
      (location) => location.name === 'afd.embedding',
    );
    expect(embedding).toMatchObject({
      kind: 'elementwise',
      tflops: {
        sampleCount: 0,
        mean: null,
        p50: null,
        p90: null,
        p99: null,
        max: null,
      },
    });
  });

  it('preserves an analyzer-declared unavailable reason', () => {
    const result = decodeAnalyzerV1KernelThroughputPayload({
      schema_version: 1,
      meta: {
        log_dir: 'logs/no-cost-log',
        available: false,
        reason: 'cost_log/ dir not found',
      },
      locations: [],
    });

    expect(result).toEqual({
      subject: 'kernelThroughput',
      status: 'unavailable',
      reason: 'cost_log/ dir not found',
    });
  });

  it('reports unsupported versions and source mismatches as incompatible', () => {
    const versioned = mutableFixture();
    versioned.schema_version = 2;
    expect(decodeAnalyzerV1KernelThroughputPayload(versioned)).toMatchObject({
      status: 'incompatible',
      receivedSchemaVersion: 2,
      reason: expect.stringContaining('unsupported version 2'),
    });

    expect(
      decodeAnalyzerV1KernelThroughputPayload(kernelThroughputJson, {
        expectedLogDir: 'logs/another-run',
      }),
    ).toMatchObject({ status: 'incompatible', reason: expect.stringContaining('meta.log_dir') });
  });

  it('requires all nullable values to agree with the sample count', () => {
    const emptyWithValue = mutableFixture();
    const emptyStats = emptyWithValue.locations.find((location) => location.tflops.n === 0)!;
    emptyStats.tflops.mean = 1;
    expect(decodeAnalyzerV1KernelThroughputPayload(emptyWithValue)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('tflops.mean: must be null when n is zero'),
    });

    const populatedWithoutValue = mutableFixture();
    populatedWithoutValue.locations[0].tflops.p90 = null;
    expect(decodeAnalyzerV1KernelThroughputPayload(populatedWithoutValue)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('tflops.p90: must be present when n is positive'),
    });
  });

  it('rejects impossible percentile ordering and maxima', () => {
    const fixture = mutableFixture();
    fixture.locations[0].tflops.p50 = 100;
    fixture.locations[0].tflops.p90 = 90;
    fixture.locations[0].gbps.mean = 10_000;

    const result = decodeAnalyzerV1KernelThroughputPayload(fixture);
    expect(result).toMatchObject({ status: 'incompatible' });
    if (result.status !== 'incompatible') return;
    expect(result.reason).toContain('tflops.p50: must not exceed p90');
    expect(result.reason).toContain('gbps.mean: must not exceed max');
  });

  it('checks exact location identities, ordering and aggregate sample totals', () => {
    const fixture = mutableFixture();
    fixture.locations[1].name = fixture.locations[0].name;
    fixture.meta.num_locations = 17;
    fixture.meta.sampled_compute_slots = 1;
    fixture.meta.sampled_memory_slots = 2;

    const result = decodeAnalyzerV1KernelThroughputPayload(fixture);
    expect(result).toMatchObject({ status: 'incompatible' });
    if (result.status !== 'incompatible') return;
    expect(result.reason).toContain('duplicate key');
    expect(result.reason).toContain('meta.num_locations');
    expect(result.reason).toContain('meta.sampled_compute_slots');
    expect(result.reason).toContain('meta.sampled_memory_slots');
  });

  it('rejects a location with neither compute nor memory samples', () => {
    const fixture = mutableFixture();
    const empty = { n: 0, mean: null, p50: null, p90: null, p99: null, max: null };
    fixture.locations[0].tflops = { ...empty };
    fixture.locations[0].gbps = { ...empty };
    fixture.meta.sampled_compute_slots =
      (fixture.meta.sampled_compute_slots as number) -
      (kernelThroughputJson.locations[0].tflops.n as number);
    fixture.meta.sampled_memory_slots =
      (fixture.meta.sampled_memory_slots as number) -
      (kernelThroughputJson.locations[0].gbps.n as number);

    expect(decodeAnalyzerV1KernelThroughputPayload(fixture)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('must contain compute or memory samples'),
    });
  });

  it('binds schema v1 to its declared rate units', () => {
    const fixture = mutableFixture();
    fixture.definitions.tflops = 'achieved compute in GFLOP/s';

    expect(decodeAnalyzerV1KernelThroughputPayload(fixture)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('definitions.tflops'),
    });
  });

  it('accepts additive v1 fields without leaking them into the domain model', () => {
    const fixture = mutableFixture();
    fixture.future_optional = true;
    (fixture.locations[0] as Record<string, unknown>).future_optional = true;
    fixture.definitions.future_optional = 'future analyzer note';

    const result = decodeAnalyzerV1KernelThroughputPayload(fixture);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.payload).not.toHaveProperty('future_optional');
    expect(result.payload.locations[0]).not.toHaveProperty('future_optional');
    expect(result.payload.definitions.future_optional).toBe('future analyzer note');
  });
});
