import { describe, expect, it } from 'vitest';

import { decodeAnalyzerV1ConcurrencyPayload } from './concurrency';

const payload = {
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
};

describe('analyzer-v1 concurrency decoder', () => {
  it('decodes time-weighted means and an exact integer peak', () => {
    expect(
      decodeAnalyzerV1ConcurrencyPayload(payload, { expectedLogDir: 'logs/test-run' }),
    ).toEqual({
      subject: 'concurrency',
      status: 'ready',
      schemaVersion: 1,
      payload: { t_ms: [500, 1_000], active: [1.25, 2.5], peak: 4 },
    });
  });

  it('rejects wrong source, parallel lengths, time order and fractional peaks', () => {
    expect(
      decodeAnalyzerV1ConcurrencyPayload(payload, { expectedLogDir: 'another-run' }),
    ).toMatchObject({ status: 'incompatible', reason: expect.stringContaining('meta.log_dir') });
    expect(decodeAnalyzerV1ConcurrencyPayload({ ...payload, active: [1.25] })).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('active'),
    });
    expect(decodeAnalyzerV1ConcurrencyPayload({ ...payload, t_ms: [1_000, 500] })).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('strictly increasing'),
    });
    expect(decodeAnalyzerV1ConcurrencyPayload({ ...payload, peak: 4.5 })).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('peak'),
    });
  });

  it('requires point count and final right edge to match metadata', () => {
    expect(
      decodeAnalyzerV1ConcurrencyPayload({ ...payload, meta: { ...payload.meta, bins: 3 } }),
    ).toMatchObject({ status: 'incompatible', reason: expect.stringContaining('meta.bins') });
    expect(
      decodeAnalyzerV1ConcurrencyPayload({ ...payload, meta: { ...payload.meta, span_ms: 999 } }),
    ).toMatchObject({ status: 'incompatible', reason: expect.stringContaining('meta.span_ms') });
    expect(decodeAnalyzerV1ConcurrencyPayload({ ...payload, active: [1.25, 5] })).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('cannot exceed exact peak'),
    });
  });
});
