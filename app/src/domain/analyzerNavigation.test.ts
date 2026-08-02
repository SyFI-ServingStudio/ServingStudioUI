import { describe, expect, it } from 'vitest';

import {
  analyzerEvidenceHref,
  analyzerNavigateCommandV2Schema,
  evidenceRefFromHash,
} from './analyzerNavigation';
import { analyzerSelectionFromEvidenceRef } from './evidenceRef';

describe('analyzer navigation protocol', () => {
  it('removes transport metadata before retaining a prediction selection', () => {
    const evidence = evidenceRefFromHash(
      '#/prediction?workspace=w_main&prediction=p_test&panel=overview',
    );

    expect(evidence).not.toBeNull();
    expect(analyzerSelectionFromEvidenceRef(evidence!)).toEqual({
      kind: 'prediction',
      workspaceId: 'w_main',
      predictionId: 'p_test',
      panelId: 'overview',
      caseId: null,
      operationId: null,
      leafId: null,
      parallelId: null,
      optimalityMode: 'unlocked',
    });
  });

  it('round-trips a bounded aggregate evidence reference through the URL', () => {
    const target = {
      protocol: 'vibesim.analyzer/v2' as const,
      kind: 'aggregate' as const,
      workspaceId: 'w_main',
      experimentId: 's_exp',
      panelId: 'tpot',
      metricKey: 'tpot_p99_ms',
      statistic: 'p99' as const,
      runId: 'r_member',
      coordinates: { request_rate: 50, tensor_parallel: 4 },
    };

    expect(evidenceRefFromHash(analyzerEvidenceHref(target))).toEqual(target);
  });

  it('round-trips a complete run evidence reference through the URL', () => {
    const target = {
      protocol: 'vibesim.analyzer/v2' as const,
      kind: 'run' as const,
      workspaceId: 'w_main',
      runId: 'r_member',
      panelId: 'kernel-breakdown',
      scope: 'kernel' as const,
      poolRole: 'decode',
      workerKey: 'decode-0',
      leafId: 12,
      parId: 3,
      cursorMs: 42.5,
      cursorNeedsSeek: true,
      operation: {
        iterId: 'iter-1',
        batchId: 'batch-2',
        operationId: 'operation-3',
      },
      workerAnalysisLevel: 'iteration' as const,
    };

    expect(evidenceRefFromHash(analyzerEvidenceHref(target))).toEqual(target);
  });

  it('round-trips an exact timing-prediction panel through the URL', () => {
    const target = {
      protocol: 'vibesim.analyzer/v2' as const,
      kind: 'prediction' as const,
      workspaceId: 'w_main',
      predictionId: 'p_test',
      panelId: 'optimality-breakdown',
      caseId: '40',
      operationId: null,
      leafId: null,
      parallelId: null,
      optimalityMode: 'batch_locked' as const,
    };

    expect(evidenceRefFromHash(analyzerEvidenceHref(target))).toEqual(target);
  });

  it('round-trips first-class kernel profile and measurement evidence', () => {
    const profile = {
      protocol: 'vibesim.analyzer/v2' as const,
      kind: 'kernel_profile' as const,
      workspaceId: 'w_main',
      profileId: 'kp_test',
      panelId: 'curve',
      metricKey: 'time_ms',
    };
    const measurement = {
      protocol: 'vibesim.analyzer/v2' as const,
      kind: 'kernel_measurement' as const,
      workspaceId: 'w_main',
      measurementId: 'km_test',
      panelId: 'plot',
      metricKey: null,
      plotName: 'runtime.png',
    };

    expect(evidenceRefFromHash(analyzerEvidenceHref(profile))).toEqual(profile);
    expect(evidenceRefFromHash(analyzerEvidenceHref(measurement))).toEqual(measurement);
  });

  it('rejects malformed coordinates and incomplete run routes', () => {
    expect(evidenceRefFromHash('#/run?experiment=s_exp')).toBeNull();
    expect(evidenceRefFromHash('#/aggregate?experiment=s_exp&coordinates=%7Bbad')).toBeNull();
  });

  it('accepts only strict versioned navigate commands', () => {
    expect(
      analyzerNavigateCommandV2Schema.safeParse({
        protocol: 'vibesim.analyzer/v2',
        requestId: 'request-1',
        type: 'navigate',
        target: {
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: 'w_main',
          experimentId: 's_exp',
          panelId: 'ttft',
        },
      }).success,
    ).toBe(true);
    expect(
      analyzerNavigateCommandV2Schema.safeParse({
        protocol: 'vibesim.analyzer/v2',
        requestId: 'request-1',
        type: 'navigate',
        target: {
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: 'w_main',
          experimentId: 's_exp',
        },
        selector: '.chart',
      }).success,
    ).toBe(false);
  });
});
