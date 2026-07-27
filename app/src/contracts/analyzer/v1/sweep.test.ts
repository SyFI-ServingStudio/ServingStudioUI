import { describe, expect, it } from 'vitest';

import { parseAnalyzerV1SweepCatalog, parseAnalyzerV1SweepPayload } from './sweep';

describe('analyzer-v1 aggregate contracts', () => {
  it('accepts an unclaimed run as a zero-axis singleton aggregate', () => {
    const catalog = parseAnalyzerV1SweepCatalog({
      protocol_version: 1,
      generated_at: '2026-07-27T00:00:00Z',
      sweeps: [
        {
          sweep_id: 's_singleton',
          kind: 'singleton',
          display_name: 'standalone-run',
          payload_href: 'sweeps/s_singleton/payload',
          axes: [],
          num_runs: 1,
          status: 'ready',
          experiment_date: '2026-07-27',
          deployments: ['unified'],
          traces: ['aime_long.csv'],
          updated_at: '2026-07-27T00:00:00Z',
        },
      ],
    });
    const payload = parseAnalyzerV1SweepPayload({
      protocol_version: 1,
      schema_version: 1,
      sweep_id: 's_singleton',
      display_name: 'standalone-run',
      meta: { num_axes: 0, num_runs: 1 },
      axes: [],
      domains: {},
      metrics: [
        {
          key: 'total_tps',
          label: 'Total throughput',
          group: 'throughput',
          unit: 'tok/s',
          objective: 'maximize',
        },
      ],
      runs: [
        {
          run_id: 'r_singleton',
          coordinates: {},
          labels: {},
          lifecycle: { simulation: 'complete', analysis: 'complete' },
          metrics: { total_tps: 42 },
        },
      ],
      definitions: {},
    });

    expect(catalog.sweeps[0]).toMatchObject({
      kind: 'singleton',
      axes: [],
      experimentDate: '2026-07-27',
      deployments: ['unified'],
      traces: ['aime_long.csv'],
    });
    expect(payload).toMatchObject({
      axes: [],
      domains: {},
      metrics: [expect.objectContaining({ objective: 'maximize' })],
      runs: [{ runId: 'r_singleton', metrics: { total_tps: 42 } }],
    });
  });
});
