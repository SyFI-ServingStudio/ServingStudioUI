import { describe, expect, it } from 'vitest';

import realConcurrency from '../../../testdata/analyzer-v1/spec5-micro-throughput/payloads/concurrency_series.json';

import {
  IncompatibleConcurrencyError,
  UnavailableConcurrencyError,
  parseConcurrency,
} from './concurrency';

export const CONCURRENCY_PAYLOAD = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/test-run',
    request_count: 7,
    span_ms: 1_000,
    bins: 2,
    max_points: 512,
    aggregation: 'equal-width time-weighted mean',
  },
  t_ms: [500, 1_000],
  active: [1.25, 2.5],
  peak: 4,
  definitions: {
    scope: 'run',
    active: 'time-weighted mean active requests',
    t_ms: 'right edge of each bucket in milliseconds',
    peak: 'exact event-sweep peak',
    binning: 'equal-width bins',
  },
} as const;

describe('parseConcurrency', () => {
  it('reads a complete production artifact without narrowing its metadata', () => {
    const concurrency = parseConcurrency(realConcurrency);
    expect(concurrency).toMatchObject({
      sourceLogDir: 'logs/20260905_2_spec5_matrix/01_micro_throughput_c256/simulation',
      requestCount: 1024,
      spanMs: 11959.2001953125,
      bins: 175,
      peak: 256,
      maxPoints: 512,
      aggregation: 'equal-width time-weighted mean',
    });
    expect(concurrency.tMs).toHaveLength(175);
    expect(concurrency.active).toHaveLength(175);
    expect(concurrency.definitions.scope).toContain('all requests admitted');
  });

  it('preserves the complete producer payload', () => {
    expect(parseConcurrency(CONCURRENCY_PAYLOAD)).toEqual({
      tMs: [500, 1_000],
      active: [1.25, 2.5],
      peak: 4,
      sourceLogDir: 'logs/test-run',
      requestCount: 7,
      spanMs: 1_000,
      bins: 2,
      maxPoints: 512,
      aggregation: 'equal-width time-weighted mean',
      definitions: {
        scope: 'run',
        active: 'time-weighted mean active requests',
        tMs: 'right edge of each bucket in milliseconds',
        peak: 'exact event-sweep peak',
        binning: 'equal-width bins',
      },
    });
  });

  it('rejects structural and semantic contradictions as versioned incompatibilities', () => {
    for (const body of [
      { ...CONCURRENCY_PAYLOAD, active: [1.25] },
      { ...CONCURRENCY_PAYLOAD, t_ms: [1_000, 500] },
      { ...CONCURRENCY_PAYLOAD, t_ms: [400, 1_000] },
      { ...CONCURRENCY_PAYLOAD, active: [1.25, 5] },
      {
        ...CONCURRENCY_PAYLOAD,
        meta: { ...CONCURRENCY_PAYLOAD.meta, span_ms: 999 },
      },
    ]) {
      try {
        parseConcurrency(body);
        throw new Error('expected parseConcurrency to reject the payload');
      } catch (error) {
        expect(error).toBeInstanceOf(IncompatibleConcurrencyError);
        expect(error).toMatchObject({ received: 1, issues: expect.any(Array) });
      }
    }
  });

  it('allows the historical few-ULP active overshoot and clamps it to the exact peak', () => {
    const body = { ...CONCURRENCY_PAYLOAD, active: [1.25, 4 + Number.EPSILON * 4] };
    expect(parseConcurrency(body).active.at(-1)).toBe(4);
  });

  it('maps the producer unavailable shape separately from incompatibility', () => {
    expect(() =>
      parseConcurrency({
        schema_version: 1,
        meta: { log_dir: 'logs/test-run', available: false, reason: 'no stage history' },
        t_ms: [],
        active: [],
        peak: 0,
        definitions: CONCURRENCY_PAYLOAD.definitions,
      }),
    ).toThrow(UnavailableConcurrencyError);
  });
});
