import { describe, expect, it } from 'vitest';

import {
  analyzerSelectionChangeV1Schema,
  analyzerSelectionV1Schema,
  inquiryContextV1Schema,
} from './analyzerSelection';

const runSelection = {
  kind: 'run' as const,
  runId: 'r_1',
  panelId: 'kernel-time-breakdown',
  scope: 'kernel' as const,
  poolRole: 'ffn',
  workerKey: 'ffn/0',
  leafId: 52,
  parId: null,
  cursorMs: 120_500,
  cursorNeedsSeek: false,
  operation: { iterId: '7', batchId: '2', operationId: '9' },
  workerAnalysisLevel: 'iteration' as const,
};

describe('analyzer selection protocol', () => {
  it('accepts aggregate and literal run VizState selections', () => {
    expect(
      analyzerSelectionV1Schema.parse({
        kind: 'aggregate',
        experimentId: 's_1',
        panelId: 'tpot',
        metricKey: 'tpot_p99_ms',
        statistic: 'p99',
        coordinates: { request_rate: 44.6, tensor_parallel: 4 },
      }),
    ).toMatchObject({ kind: 'aggregate', panelId: 'tpot' });
    expect(analyzerSelectionV1Schema.parse(runSelection)).toEqual(runSelection);
  });

  it('keeps inquiry identity outside the analyzer selection', () => {
    expect(
      inquiryContextV1Schema.parse({
        protocol: 'vibesim.inquiry-context/v1',
        inquiryId: 'inq_01',
        phaseId: 'refine_01',
        selection: runSelection,
      }),
    ).toMatchObject({ inquiryId: 'inq_01', phaseId: 'refine_01' });
  });

  it('requires a positive revision for selection notifications', () => {
    expect(
      analyzerSelectionChangeV1Schema.safeParse({
        protocol: 'vibesim.analyzer/v1',
        type: 'selection-change',
        revision: 0,
        selection: runSelection,
      }).success,
    ).toBe(false);
  });
});
