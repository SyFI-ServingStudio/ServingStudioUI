import { describe, expect, it } from 'vitest';

import { analyzerTurnContextV2Schema } from '../session/citation';
import { EMPTY_FOCUS, type Location } from '../location';
import { agentContext } from './agentContext';

describe('agentContext', () => {
  it('projects an exact worker leaf Location into the frozen run selection', () => {
    const location: Location = {
      view: 'result',
      ref: { kind: 'run', id: 'r_one', workspace: 'w_main', revision: 'analysis-2' },
      focus: {
        ...EMPTY_FOCUS,
        panel: 'worker.cost-tree',
        cursorMs: 42.5,
        path: [
          { at: 'pool', role: 'a b' },
          { at: 'worker', id: 'x/y' },
          { at: 'operation', iter: '7', batch: '8', op: '9' },
          { at: 'leaf', id: 3 },
        ],
      },
      chat: { state: 'draft', workspace: 'w_main' },
    };

    const context = agentContext(location);
    expect(context?.selection).toEqual({
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'r_one',
      panelId: 'worker.cost-tree',
      scope: 'kernel',
      poolRole: 'a b',
      workerKey: 'a%20b/x%2Fy',
      leafId: 3,
      parId: null,
      cursorMs: 42.5,
      cursorNeedsSeek: false,
      operation: { iterId: '7', batchId: '8', operationId: '9' },
      workerAnalysisLevel: 'iteration',
    });
    expect(context?.display.values).toEqual([
      'run',
      'worker.cost-tree',
      'kernel',
      'pool=a b',
      'worker=a%20b/x%2Fy',
      'kernel=3',
    ]);
    expect(analyzerTurnContextV2Schema.parse(context?.turn)).toMatchObject({
      protocol: 'vibesim.conversation-context/v2',
      citationDictionary: {
        entries: expect.arrayContaining([
          expect.objectContaining({ token: 'run.kernel.kernel-time' }),
          expect.objectContaining({ token: 'run.kernel.selected.worker_cost-tree' }),
        ]),
      },
    });
  });

  it('derives prediction coordinates and options without a selection store', () => {
    const location: Location = {
      view: 'result',
      ref: { kind: 'prediction', id: 'p_one', workspace: 'w_main' },
      focus: {
        path: [
          { at: 'case', id: 'c/1' },
          { at: 'caseOperation', id: 'op-2' },
          { at: 'parallel', id: 4 },
        ],
        cursorMs: null,
        panel: 'prediction.detail',
        options: { optimality: 'batch_locked' },
      },
      chat: null,
    };

    expect(agentContext(location)?.selection).toEqual({
      kind: 'prediction',
      workspaceId: 'w_main',
      predictionId: 'p_one',
      panelId: 'prediction.detail',
      caseId: 'c/1',
      operationId: 'op-2',
      leafId: null,
      parallelId: 4,
      optimalityMode: 'batch_locked',
    });
  });

  it('keeps the worker CostTree in iteration mode before an operation resolves', () => {
    const location: Location = {
      view: 'result',
      ref: { kind: 'run', id: 'r_one', workspace: 'w_main' },
      focus: {
        ...EMPTY_FOCUS,
        panel: 'worker.cost-tree',
        path: [
          { at: 'pool', role: 'decode' },
          { at: 'worker', id: '0' },
        ],
      },
      chat: null,
    };

    expect(agentContext(location)?.selection).toMatchObject({
      kind: 'run',
      operation: null,
      workerAnalysisLevel: 'iteration',
    });
  });

  it('uses the selected evidence card while retaining the complete run page', () => {
    const location: Location = {
      view: 'result',
      ref: { kind: 'run', id: 'r_one', workspace: 'w_main' },
      focus: {
        ...EMPTY_FOCUS,
        panel: null,
        options: { 'evidence-panel': 'utilization' },
      },
      chat: null,
    };

    expect(agentContext(location)?.selection).toMatchObject({
      kind: 'run',
      panelId: 'utilization',
      scope: 'cluster',
    });
  });

  it('does not invent an aggregate dictionary before the matching sweep is loaded', () => {
    expect(
      agentContext({
        view: 'result',
        ref: { kind: 'sweep', id: 's_one', workspace: 'w_main' },
        focus: EMPTY_FOCUS,
        chat: null,
      }),
    ).toBeNull();
  });

  it('preserves the dynamic sweep panel and coordinate-only member in frozen context', () => {
    const location: Location = {
      view: 'result',
      ref: { kind: 'sweep', id: 's_one', workspace: 'w_main' },
      focus: {
        ...EMPTY_FOCUS,
        panel: 'sweep.page',
        path: [{ at: 'run', coordinates: { tp: 4, dtype: 'fp8' } }],
        options: { 'evidence-panel': 'throughput', metric: 'total_tps' },
      },
      chat: null,
    };
    const analysis = {
      protocolVersion: 1 as const,
      schemaVersion: 1 as const,
      workspaceId: 'w_main',
      sweepId: 's_one',
      displayName: 'Sweep one',
      axes: ['tp', 'dtype'],
      domains: { tp: [4], dtype: ['fp8'] },
      metrics: [
        {
          key: 'total_tps',
          label: 'Total throughput',
          group: 'throughput',
          unit: 'tok/s',
          objective: 'maximize' as const,
        },
      ],
      runs: [
        {
          runId: null,
          coordinates: { tp: 4, dtype: 'fp8' },
          labels: { tp: 'TP 4', dtype: 'fp8' },
          lifecycle: { simulation: 'complete' as const, analysis: 'complete' as const },
          metrics: { total_tps: 100 },
        },
      ],
      definitions: {},
    };
    expect(agentContext(location, analysis)?.selection).toMatchObject({
      kind: 'aggregate',
      panelId: 'throughput',
      metricKey: 'total_tps',
      coordinates: { tp: 4, dtype: 'fp8' },
    });
  });

  it('does not invent a v2 selection for an alignment or a non-result page', () => {
    expect(
      agentContext({
        view: 'result',
        ref: { kind: 'alignment', id: 'a_one', workspace: 'w_main' },
        focus: EMPTY_FOCUS,
        chat: null,
      }),
    ).toBeNull();
    expect(
      agentContext({
        view: 'catalog',
        filter: { workspace: 'w_main', kinds: [], query: null },
      }),
    ).toBeNull();
  });
});
