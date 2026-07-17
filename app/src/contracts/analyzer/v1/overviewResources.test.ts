import { describe, expect, it } from 'vitest';

import { parseAnalyzerV1ModelResource, parseAnalyzerV1WorkloadResource } from './overviewResources';

const workload = {
  schema_version: 1,
  scope: 'configured_trace',
  source_paths: ['trace/test.csv'],
  request_count: 2,
  average_input_tokens: 24,
  average_output_tokens: 20,
  arrival_basis: 'effective_open_loop',
  request_rate: 4,
  token_lengths: [16, 32],
  input_density: [0.5, 1],
  output_density: [1, 0.5],
  arrival_seconds: [0, 0.5],
  arrivals: [1, 1],
  arrival_trend: [1, 1],
  peak_to_mean: 1,
};

describe('analyzer-v1 overview resources', () => {
  it('preserves raw model config behind a validated repo source path', () => {
    expect(
      parseAnalyzerV1ModelResource({
        schema_version: 1,
        source_path: 'model/config/test.json',
        config: { hidden_size: 6144, architectures: ['TestForCausalLM'] },
      }),
    ).toEqual({
      schemaVersion: 1,
      sourcePath: 'model/config/test.json',
      config: { hidden_size: 6144, architectures: ['TestForCausalLM'] },
    });
  });

  it('rejects escaped model and workload source paths', () => {
    expect(() =>
      parseAnalyzerV1ModelResource({
        schema_version: 1,
        source_path: 'model/config/../secret.json',
        config: {},
      }),
    ).toThrow(/normalized repository-relative path/);
    expect(() =>
      parseAnalyzerV1WorkloadResource({ ...workload, source_paths: ['other/test.csv'] }),
    ).toThrow(/must be below trace/);
  });

  it('accepts bounded parallel workload series', () => {
    expect(parseAnalyzerV1WorkloadResource(workload)).toMatchObject({
      requestCount: 2,
      averageInputTokens: 24,
      averageOutputTokens: 20,
      tokenLengths: [16, 32],
      arrivalSeconds: [0, 0.5],
    });
  });

  it('rejects mismatched, non-finite and oversized workload series', () => {
    expect(() => parseAnalyzerV1WorkloadResource({ ...workload, input_density: [0.5] })).toThrow(
      /must have equal lengths/,
    );
    expect(() =>
      parseAnalyzerV1WorkloadResource({ ...workload, arrivals: [Number.POSITIVE_INFINITY, 1] }),
    ).toThrow(/finite/);
    expect(() =>
      parseAnalyzerV1WorkloadResource({ ...workload, token_lengths: Array(73).fill(1) }),
    ).toThrow(/at most 72/);
  });
});
