import { describe, expect, it } from 'vitest';

import runSummaryJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/summary.json';
import { parseAnalyzerV1RunSummary } from './runSummary';

function validSummary(): Record<string, unknown> {
  return structuredClone(runSummaryJson) as Record<string, unknown>;
}

describe('parseAnalyzerV1RunSummary', () => {
  it('decodes the real analyzer fixture without discarding run facts', () => {
    const summary = parseAnalyzerV1RunSummary(runSummaryJson);

    expect(summary).toMatchObject({
      totalTokS: 54_635.432,
      numGpus: 48,
      requestsFinished: 5_587,
      requestsTotal: 150_000,
      cause: 'DurationReached',
      decodeTokens: 107_997_694,
      prefillTokens: 1_273_170,
      totalTokens: 109_270_864,
      simMs: 2_000_000,
    });
  });

  it('rejects a finished request count above the offered count', () => {
    const summary = validSummary();
    summary.requests_finished = 150_001;

    expect(() => parseAnalyzerV1RunSummary(summary)).toThrow(
      /requests_finished: must not exceed requests_total/,
    );
  });

  it('rejects inconsistent exact token totals', () => {
    const summary = validSummary();
    summary.total_tokens = 1;

    expect(() => parseAnalyzerV1RunSummary(summary)).toThrow(
      /total_tokens: must equal prefill_tokens \+ decode_tokens/,
    );
  });

  it.each([
    ['negative GPU count', 'num_gpus', -1],
    ['fractional request count', 'requests_finished', 1.5],
    ['infinite throughput', 'total_tok_s', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_caseName, field, value) => {
    const summary = validSummary();
    summary[field] = value;

    expect(() => parseAnalyzerV1RunSummary(summary)).toThrow(new RegExp(`${field}:`));
  });

  it('rejects unknown fields because summary has no independent schema version', () => {
    const summary = validSummary();
    summary.surprise = true;

    expect(() => parseAnalyzerV1RunSummary(summary)).toThrow(/<root>: Unrecognized key/);
  });
});
