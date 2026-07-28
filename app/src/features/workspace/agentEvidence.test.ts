import { describe, expect, it } from 'vitest';

import type { SweepAnalysis } from '../../domain/sweep';
import { firstThroughputEvidence } from './agentEvidence';

const analysis: SweepAnalysis = {
  protocolVersion: 1,
  schemaVersion: 1,
  workspaceId: 'w_main',
  sweepId: 's_test',
  displayName: 'test',
  axes: ['request_rate'],
  domains: { request_rate: [10] },
  metrics: [
    {
      key: 'ttft_mean_ms',
      label: 'Mean TTFT',
      group: 'ttft',
      unit: 'ms',
      objective: 'minimize',
    },
    {
      key: 'total_tps',
      label: 'Total throughput',
      group: 'throughput',
      unit: 'tok/s',
      objective: 'maximize',
    },
  ],
  runs: [],
  definitions: {},
};

describe('firstThroughputEvidence', () => {
  it('returns a panel identity accepted by the aggregate analyzer', () => {
    expect(firstThroughputEvidence(analysis)).toEqual({
      panelId: 'total_tps',
      metricKey: 'total_tps',
    });
  });
});
