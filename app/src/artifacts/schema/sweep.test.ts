import { describe, expect, it } from 'vitest';

import { AnalyzerV1SweepContractError, parseAnalyzerV1SweepPayload } from './sweep';

function payload(): Record<string, unknown> {
  return {
    protocol_version: 1,
    schema_version: 1,
    workspace_id: 'w_main',
    sweep_id: 's_one',
    display_name: 'Sweep one',
    meta: { num_axes: 1, num_runs: 2 },
    axes: ['tp'],
    domains: { tp: [1, 2] },
    metrics: [
      { group: 'throughput', key: 'tps', label: 'TPS', unit: 'tok/s', objective: 'maximize' },
    ],
    runs: [1, 2].map((tp) => ({
      run_id: null,
      coordinates: { tp },
      labels: { tp: `TP ${tp}` },
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { tps: tp * 100 },
    })),
    definitions: {},
  };
}

function refusal(input: unknown): AnalyzerV1SweepContractError {
  try {
    parseAnalyzerV1SweepPayload(input);
    throw new Error('expected refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(AnalyzerV1SweepContractError);
    return error as AnalyzerV1SweepContractError;
  }
}

describe('canonical sweep payload', () => {
  it('accepts coordinate-only members and a legal singleton', () => {
    expect(parseAnalyzerV1SweepPayload(payload()).runs[0]?.runId).toBeNull();
    const singleton = payload();
    singleton.meta = { num_axes: 0, num_runs: 1 };
    singleton.axes = [];
    singleton.domains = {};
    singleton.runs = [(singleton.runs as unknown[])[0]];
    (singleton.runs as Array<Record<string, unknown>>)[0]!.coordinates = {};
    expect(parseAnalyzerV1SweepPayload(singleton).axes).toEqual([]);
  });

  it('retains producer metrics that are not part of the display descriptor list', () => {
    const wire = payload();
    const firstRun = (wire.runs as Array<Record<string, unknown>>)[0]!;
    firstRun.metrics = { ...(firstRun.metrics as Record<string, unknown>), tps_p50: 95 };

    expect(parseAnalyzerV1SweepPayload(wire).runs[0]?.metrics).toEqual({
      tps: 100,
      tps_p50: 95,
    });
  });

  it('reports the producer schema version through structured incompatibility', () => {
    const wrong = payload();
    wrong.schema_version = 7;
    const error = refusal(wrong);
    expect(error.received).toBe(7);
    expect(error.issues.join('\n')).toContain('schema_version');
  });

  it.each([
    ['duplicate axes', (wire: Record<string, unknown>) => (wire.axes = ['tp', 'tp'])],
    [
      'coordinate keys',
      (wire: Record<string, unknown>) =>
        ((
          (wire.runs as Array<Record<string, unknown>>)[0]!.coordinates as Record<string, unknown>
        ).extra = 3),
    ],
    [
      'coordinate tuple',
      (wire: Record<string, unknown>) =>
        ((wire.runs as Array<Record<string, unknown>>)[1]!.coordinates = { tp: 1 }),
    ],
    ['domain identity', (wire: Record<string, unknown>) => (wire.domains = { tp: [1, 3] })],
    [
      'metric identity',
      (wire: Record<string, unknown>) =>
        ((wire.runs as Array<Record<string, unknown>>)[0]!.metrics = {}),
    ],
  ])('rejects invalid %s', (_label, mutate) => {
    const wire = payload();
    mutate(wire);
    expect(() => parseAnalyzerV1SweepPayload(wire)).toThrow(AnalyzerV1SweepContractError);
  });

  it('rejects a payload for another result identity', () => {
    expect(() =>
      parseAnalyzerV1SweepPayload(payload(), { workspace: 'w_main', id: 's_other' }),
    ).toThrow(/asked for w_main\/s_other/);
  });
});
