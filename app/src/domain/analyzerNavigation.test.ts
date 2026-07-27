import { describe, expect, it } from 'vitest';

import {
  analyzerEvidenceHref,
  analyzerNavigateCommandV1Schema,
  evidenceRefFromHash,
} from './analyzerNavigation';

describe('analyzer navigation protocol', () => {
  it('round-trips a bounded aggregate evidence reference through the URL', () => {
    const target = {
      protocol: 'vibesim.analyzer/v1' as const,
      experimentId: 's_exp',
      panelId: 'tpot',
      metricKey: 'tpot_p99_ms',
      statistic: 'p99' as const,
      runId: 'r_member',
      coordinates: { request_rate: 50, tensor_parallel: 4 },
    };

    expect(evidenceRefFromHash(analyzerEvidenceHref(target))).toEqual(target);
  });

  it('rejects malformed coordinates and non-aggregate routes', () => {
    expect(evidenceRefFromHash('#/run?experiment=s_exp')).toBeNull();
    expect(evidenceRefFromHash('#/aggregate?experiment=s_exp&coordinates=%7Bbad')).toBeNull();
  });

  it('accepts only strict versioned navigate commands', () => {
    expect(
      analyzerNavigateCommandV1Schema.safeParse({
        protocol: 'vibesim.analyzer/v1',
        requestId: 'request-1',
        type: 'navigate',
        target: {
          protocol: 'vibesim.analyzer/v1',
          experimentId: 's_exp',
          panelId: 'ttft',
        },
      }).success,
    ).toBe(true);
    expect(
      analyzerNavigateCommandV1Schema.safeParse({
        protocol: 'vibesim.analyzer/v1',
        requestId: 'request-1',
        type: 'navigate',
        target: { protocol: 'vibesim.analyzer/v1', experimentId: 's_exp' },
        selector: '.chart',
      }).success,
    ).toBe(false);
  });
});
