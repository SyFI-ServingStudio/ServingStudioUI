import { describe, expect, it } from 'vitest';

import { predictionCasesRef } from '../ref';
import { parsePredictionCases } from './prediction';

const result = { kind: 'prediction' as const, id: 'p_one', workspace: 'w_main' };

function page(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    prediction_id: 'p_one',
    range: { offset: 64, limit: 64, returned: 1, total: 65 },
    cases: [
      {
        case_id: 64,
        input: {},
        total_time_ms: 1,
        operations: [{ operation_id: 0, section: 'attn', layer: 0, time_ms: 1 }],
      },
    ],
    ...overrides,
  };
}

describe('prediction case artifact identity', () => {
  it('binds the returned range to the requested cache key', () => {
    const ref = predictionCasesRef(result, 64, 64);
    expect(parsePredictionCases(page(), ref).offset).toBe(64);
    expect(() =>
      parsePredictionCases(page({ range: { offset: 0, limit: 64, returned: 1, total: 65 } }), ref),
    ).toThrow(/asked for offset 64/);
  });

  it('rejects non-contiguous case and operation identities', () => {
    const ref = predictionCasesRef(result, 64, 64);
    expect(() =>
      parsePredictionCases(
        page({
          cases: [
            {
              case_id: 63,
              input: {},
              total_time_ms: 1,
              operations: [{ operation_id: 2, section: 'attn', layer: 0, time_ms: 1 }],
            },
          ],
        }),
        ref,
      ),
    ).toThrow(/expected contiguous id/);
  });

  it("accepts the producer's empty page beyond the end of the result", () => {
    const ref = predictionCasesRef(result, 960, 64);
    const value = parsePredictionCases(
      page({
        range: { offset: 960, limit: 64, returned: 0, total: 3 },
        cases: [],
      }),
      ref,
    );
    expect(value).toMatchObject({ offset: 960, total: 3, cases: [] });
  });

  it('does not report a string schema version as a received numeric version', () => {
    try {
      parsePredictionCases(page({ schema_version: '1' }), predictionCasesRef(result, 64, 64));
      throw new Error('expected parser to fail');
    } catch (error) {
      expect(error).toMatchObject({ received: undefined });
    }
  });
});
