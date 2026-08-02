import { describe, expect, it } from 'vitest';

import type { SweepAnalysis } from '../../domain/sweep';
import { analyzerTurnContext } from './citationDictionary';

const analysis: SweepAnalysis = {
  protocolVersion: 1,
  schemaVersion: 1,
  workspaceId: 'w_main',
  sweepId: 's_test',
  displayName: 'TP and rate sweep',
  axes: ['tensor_parallel', 'request_rate'],
  domains: {
    tensor_parallel: [1, 2],
    request_rate: [10, 20],
  },
  metrics: [
    {
      key: 'total_tps',
      label: 'Total throughput',
      group: 'throughput',
      unit: 'tok/s',
      objective: 'maximize',
    },
    {
      key: 'ttft_mean_ms',
      label: 'Mean TTFT',
      group: 'ttft',
      unit: 'ms',
      objective: 'minimize',
    },
  ],
  // Deliberately sparse: tp1/rate20 and tp2/rate10 do not exist.
  runs: [
    {
      runId: 'r_1_10',
      coordinates: { tensor_parallel: 1, request_rate: 10 },
      labels: { tensor_parallel: 'TP=1', request_rate: 'rate=10' },
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { total_tps: 100, ttft_mean_ms: 12 },
    },
    {
      runId: 'r_2_20',
      coordinates: { tensor_parallel: 2, request_rate: 20 },
      labels: { tensor_parallel: 'TP=2', request_rate: 'rate=20' },
      lifecycle: { simulation: 'complete', analysis: 'complete' },
      metrics: { total_tps: 180, ttft_mean_ms: 15 },
    },
  ],
  definitions: {},
};

describe('citation dictionary', () => {
  it('preserves launcher axis order and only publishes actual members', () => {
    const context = analyzerTurnContext(
      { kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_test' },
      analysis,
    );
    const tokens = context?.citationDictionary.entries.map((entry) => entry.token) ?? [];

    expect(tokens).toContain('exp.tp1.rate10.throughput');
    expect(tokens).toContain('exp.tp2.rate20.ttft.mean');
    expect(tokens).not.toContain('exp.tp1.rate20.throughput');
    expect(tokens).not.toContain('exp.rate10.tp1.throughput');
  });

  it('freezes the exact experiment, run, coordinates, panel, and metric', () => {
    const context = analyzerTurnContext(
      { kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_test' },
      analysis,
    );
    const entry = context?.citationDictionary.entries.find(
      (candidate) => candidate.token === 'exp.tp2.rate20.throughput',
    );

    expect(entry?.target).toEqual({
      protocol: 'vibesim.analyzer/v2',
      kind: 'aggregate',
      workspaceId: 'w_main',
      experimentId: 's_test',
      panelId: 'total_tps',
      metricKey: 'total_tps',
      runId: 'r_2_20',
      coordinates: { tensor_parallel: 2, request_rate: 20 },
    });
  });

  it('builds run references from the full literal run selection', () => {
    const context = analyzerTurnContext({
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'r_2_20',
      panelId: null,
      scope: 'worker',
      poolRole: 'decode',
      workerKey: 'decode-0',
      leafId: null,
      parId: null,
      cursorMs: 12,
      cursorNeedsSeek: false,
      operation: null,
      workerAnalysisLevel: 'worker',
    });
    const entry = context?.citationDictionary.entries.find(
      (candidate) => candidate.token === 'run.worker.utilization',
    );

    expect(entry?.target).toMatchObject({
      kind: 'run',
      runId: 'r_2_20',
      panelId: 'utilization',
      scope: 'worker',
      poolRole: 'decode',
      workerKey: 'decode-0',
      cursorMs: 12,
    });
  });

  it('builds a path-ready timing-prediction citation without run identity', () => {
    const context = analyzerTurnContext({
      kind: 'prediction',
      workspaceId: 'w_main',
      predictionId: 'p_test',
      panelId: 'optimality-breakdown',
      caseId: '40',
      operationId: null,
      leafId: null,
      parallelId: null,
      optimalityMode: 'batch_locked',
    });
    const entry = context?.citationDictionary.entries[0];

    expect(entry?.token).toBe('pred.casev40.batch_locked.optimality-breakdown');
    expect(entry?.target).toEqual({
      protocol: 'vibesim.analyzer/v2',
      kind: 'prediction',
      workspaceId: 'w_main',
      predictionId: 'p_test',
      panelId: 'optimality-breakdown',
      caseId: '40',
      operationId: null,
      leafId: null,
      parallelId: null,
      optimalityMode: 'batch_locked',
    });
    expect(entry?.target).not.toHaveProperty('runId');
  });

  it('builds exact kernel profile and measurement citations', () => {
    const profile = analyzerTurnContext({
      kind: 'kernel_profile',
      workspaceId: 'w_main',
      profileId: 'kp_test',
      panelId: 'curve',
      metricKey: 'time_ms',
    });
    const measurement = analyzerTurnContext({
      kind: 'kernel_measurement',
      workspaceId: 'w_main',
      measurementId: 'km_test',
      panelId: 'summary',
      metricKey: 'median',
      plotName: null,
    });

    expect(profile?.citationDictionary.entries[0]?.token).toBe('kprof.curve.time_ms');
    expect(measurement?.citationDictionary.entries[0]?.token).toBe(
      'kmeasure.summary.median',
    );
  });
});
