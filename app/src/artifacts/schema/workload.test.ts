import { describe, expect, it } from 'vitest';

import { IncompatibleRunWorkloadError, parseRunWorkload } from './workload';

const BODY = {
  schema_version: 1,
  scope: 'configured_trace',
  source_paths: ['trace/requests.csv'],
  request_count: 2,
  average_input_tokens: 24,
  average_output_tokens: 48.5,
  arrival_basis: 'effective_open_loop',
  request_rate: 4,
  token_lengths: [16, 32],
  input_density: [0.5, 1],
  output_density: [1, 0.5],
  arrival_seconds: [0, 0.5],
  arrivals: [1, 1],
  arrival_trend: [1, 1],
  peak_to_mean: 1.25,
} as const;

describe('parseRunWorkload', () => {
  it('retains every scalar and bounded series used by the existing overview', () => {
    expect(parseRunWorkload(BODY)).toMatchObject({
      averageInputTokens: 24,
      averageOutputTokens: 48.5,
      requestRate: 4,
      tokenLengths: [16, 32],
      arrivalSeconds: [0, 0.5],
      peakToMean: 1.25,
    });
  });

  it('refuses mismatched parallel series', () => {
    expect(() => parseRunWorkload({ ...BODY, input_density: [0.5] })).toThrow(
      IncompatibleRunWorkloadError,
    );
    expect(() => parseRunWorkload({ ...BODY, arrivals: [1] })).toThrow(
      IncompatibleRunWorkloadError,
    );
  });

  it('refuses escaped paths, unknown fields, oversized arrays and newer versions', () => {
    expect(() => parseRunWorkload({ ...BODY, source_paths: ['../requests.csv'] })).toThrow();
    expect(() => parseRunWorkload({ ...BODY, extra: true })).toThrow();
    expect(() => parseRunWorkload({ ...BODY, token_lengths: Array(73).fill(1) })).toThrow();
    expect(() => parseRunWorkload({ ...BODY, schema_version: 2 })).toThrow(
      IncompatibleRunWorkloadError,
    );
  });
});
