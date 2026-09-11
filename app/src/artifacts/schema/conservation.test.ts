/**
 * What the conservation parser accepts, and what it refuses.
 *
 * The document is unusual among this build's subjects: almost all of it is the
 * producer's own conclusions rather than measurements, and the panel prints
 * those conclusions rather than recomputing them. So what is checked here is
 * that the conclusions follow — that a status is the status its own numbers and
 * thresholds imply, that a percentage is the percentage of the numbers beside
 * it, and that the one-line summary agrees with the rows it summarises. A
 * report where any of those has come apart is one where the panel would state a
 * verdict the document does not support, and nothing else on the page would
 * contradict it.
 *
 * The fixture is four checks covering the shapes the producer emits: an
 * ordinary identity that reconciles, one of the "there should be none of this"
 * kind, one carrying a boundary allowance, and one that fails.
 */
import { describe, expect, it } from 'vitest';

import {
  CONSERVATION_SCHEMA_VERSION,
  IncompatibleConservationError,
  UnavailableConservationError,
  conservationVersion,
  parseConservation,
} from './conservation';

interface Check {
  name: string;
  description: string;
  expected: number;
  actual: number;
  delta: number;
  delta_pct: number | null;
  status: 'OK' | 'WARN' | 'FAIL';
  positive_boundary_allowance?: number;
  unexplained_delta?: number;
  unexplained_delta_pct?: number | null;
}

/** A check as the producer writes one: delta and percentage derived, not typed. */
function check(name: string, expected: number, actual: number, status: Check['status']): Check {
  const delta = actual - expected;
  return {
    name,
    description: `${name}: what the workload implies vs what the log holds`,
    expected,
    actual,
    delta,
    delta_pct: expected !== 0 ? (delta / expected) * 100 : delta === 0 ? 0 : null,
    status,
  };
}

function report(over: Partial<{ checks: Check[]; all_ok: boolean }> = {}) {
  const checks = over.checks ?? [
    check('prefill_tokens', 524288, 524288, 'OK'),
    check('prefix_hit_bounds', 0, 0, 'OK'),
    check('decode_passes', 130560, 130560, 'OK'),
    check('ffn_token_pass', 654848, 654848, 'OK'),
  ];
  return {
    schema_version: CONSERVATION_SCHEMA_VERSION,
    available: true as const,
    meta: {
      deployment: 'unified',
      num_requests: 512,
      num_iterations: 106435,
      log_dir: 'logs/whatever',
    },
    all_ok: over.all_ok ?? checks.every((one) => one.status === 'OK'),
    tolerance_pct: 0.01,
    warn_pct: 5,
    checks,
    definitions: { causal_note: 'the attention work formula' },
  };
}

function refused(body: unknown): readonly string[] {
  try {
    parseConservation(body);
  } catch (error) {
    if (error instanceof IncompatibleConservationError) return error.issues;
    throw error;
  }
  throw new Error('expected the report to be refused');
}

describe('parseConservation', () => {
  it('reads the checks, the verdicts and the thresholds they were judged by', () => {
    const value = parseConservation(report());
    expect(value.checks).toHaveLength(4);
    expect(value.checks[0]).toEqual({
      name: 'prefill_tokens',
      description: 'prefill_tokens: what the workload implies vs what the log holds',
      expected: 524288,
      actual: 524288,
      delta: 0,
      deltaPercent: 0,
      status: 'ok',
      allowance: null,
      // No allowance published means none applied, so the gap the status was
      // decided on is the gap itself — not zero, which would say every check
      // reconciles on the field that says how far off one is.
      unexplained: 0,
    });
    expect(value.allOk).toBe(true);
    expect(value.tolerancePercent).toBe(0.01);
    expect(value.warnPercent).toBe(5);
    expect(value.deployment).toBe('unified');
    expect(value.requests).toBe(512);
    expect(value.iterations).toBe(106435);
    expect(value.definitions).toEqual({ causal_note: 'the attention work formula' });
  });

  it('reads a check that found what should not exist, which has no percentage', () => {
    // `expected` is zero, so the producer's percentage is an infinity, and JSON
    // carries that as null. The most serious result a check can have is the one
    // with the empty percentage column.
    const found = { ...check('prefix_hit_bounds', 0, 3, 'FAIL'), delta_pct: null };
    const value = parseConservation(report({ checks: [found] }));
    expect(value.checks[0].deltaPercent).toBeNull();
    expect(value.checks[0].status).toBe('fail');
    expect(value.checks[0].delta).toBe(3);
    expect(value.allOk).toBe(false);
  });

  it('reads the allowance and the gap it leaves', () => {
    // A run stopped by the clock can leave one decode token partway through the
    // pipeline. That much surplus is expected; the rest is not, and it is the
    // rest the status was decided on.
    const tail: Check = {
      ...check('ffn_token_pass', 1000, 1004, 'OK'),
      positive_boundary_allowance: 4,
      unexplained_delta: 0,
      unexplained_delta_pct: 0,
    };
    const value = parseConservation(report({ checks: [tail] }));
    expect(value.checks[0].allowance).toBe(4);
    expect(value.checks[0].unexplained).toBe(0);
    // The raw gap survives: the panel prints what was logged against what was
    // expected, and rewriting the gap as the unexplained part would hide four
    // tokens the log really does hold.
    expect(value.checks[0].delta).toBe(4);
    expect(value.checks[0].deltaPercent).toBeCloseTo(0.4, 12);
    expect(value.checks[0].status).toBe('ok');
  });

  it('says the analysis has nothing, with the reason it gave', () => {
    expect(() =>
      parseConservation({
        schema_version: 1,
        available: false,
        reason: 'request_slo.parquet not found',
      }),
    ).toThrow(UnavailableConservationError);
  });

  it('reports the version a future report claims', () => {
    const body = { ...report(), schema_version: 4 };
    expect(conservationVersion(body)).toBe(4);
    try {
      parseConservation(body);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleConservationError);
      expect((error as IncompatibleConservationError).received).toBe(4);
    }
  });

  it('refuses a verdict its own numbers do not support', () => {
    // The load-bearing check. Everything the panel prints hangs off `status`,
    // and it is the one figure in the document that nothing else contradicts:
    // a check 40% out that says OK draws a reassuring line over a run whose
    // logs do not add up.
    const body = report({ checks: [check('decode_passes', 1000, 1400, 'OK')] });
    expect(refused(body).join('\n')).toContain(
      'says OK, but an unexplained gap of 400 against 1000 is FAIL',
    );
  });

  it('refuses a verdict that is too harsh as well as one that is too kind', () => {
    // Both directions, because a panel that cried wolf would be read past on
    // the day it was right.
    const body = report({ checks: [check('decode_passes', 1000, 1000, 'FAIL')] });
    expect(refused(body).join('\n')).toContain('says FAIL, but an unexplained gap of 0');
  });

  it('places a gap between the two thresholds as a warning', () => {
    // 1% is above the 0.01% tolerance and below the 5% warning line. Asserted
    // as an acceptance rather than a refusal: the middle band is the one a
    // status check could quietly collapse without any refusal test noticing.
    const body = report({ checks: [check('decode_passes', 1000, 1010, 'WARN')] });
    expect(parseConservation(body).checks[0].status).toBe('warn');
    expect(
      refused(report({ checks: [check('decode_passes', 1000, 1010, 'OK')] })).join('\n'),
    ).toContain('is WARN');
  });

  it('judges a check on the gap the allowance leaves, not on the whole gap', () => {
    // The distinction the panel exists to respect: 4% out and passing, because
    // the producer accounts for all but a sliver of it first. A parser that
    // checked the status against the raw gap would refuse this report.
    const tail: Check = {
      ...check('ffn_token_pass', 1000, 1040, 'OK'),
      positive_boundary_allowance: 40,
      unexplained_delta: 0,
      unexplained_delta_pct: 0,
    };
    const value = parseConservation(report({ checks: [tail] }));
    expect(value.checks[0].deltaPercent).toBeCloseTo(4, 12);
    expect(value.checks[0].status).toBe('ok');
  });

  it('refuses an allowance that swallows a shortfall', () => {
    // Positive-only at the source. Work that is missing is missing, and an
    // allowance applied to it would report missing work as expected.
    const swallowed: Check = {
      ...check('ffn_token_pass', 1000, 960, 'OK'),
      positive_boundary_allowance: 40,
      unexplained_delta: 0,
      unexplained_delta_pct: 0,
    };
    expect(refused(report({ checks: [swallowed] })).join('\n')).toContain(
      'an allowance of 40 against a gap of -40 leaves -40, not 0',
    );
  });

  it('refuses an allowance published without the gap it leaves', () => {
    const half: Check = { ...check('ffn_token_pass', 1000, 1004, 'OK'), unexplained_delta: 0 };
    expect(refused(report({ checks: [half] })).join('\n')).toContain(
      'published together or not at all',
    );
  });

  it('refuses a gap that is not the difference it claims to be', () => {
    const body = report();
    body.checks[0].delta = 17;
    expect(refused(body).join('\n')).toContain('delta is 17, but actual minus expected is 0');
  });

  it('refuses a percentage that is not the proportion beside it', () => {
    const body = report({ checks: [check('decode_passes', 1000, 1010, 'WARN')] });
    body.checks[0].delta_pct = 50;
    expect(refused(body).join('\n')).toContain('delta_pct is 50, but 10 of 1000 is 1');
  });

  it('refuses a missing percentage where there was something to divide by', () => {
    // A null here is not "unknown" — it means the expectation was zero. Read on
    // a check that expected half a million tokens it would hide the size of a
    // gap the reader could have judged for themselves.
    const body = report();
    body.checks[0].delta_pct = null;
    expect(refused(body).join('\n')).toContain('delta_pct is absent, but expected 524288');
  });

  it('refuses a percentage of nothing', () => {
    const body = report({
      checks: [{ ...check('prefix_hit_bounds', 0, 3, 'FAIL'), delta_pct: 300 }],
    });
    expect(refused(body).join('\n')).toContain('3 of nothing has no percentage');
  });

  it('refuses a summary that disagrees with the rows under it', () => {
    // Most readers see the summary and nothing else, so a summary that has come
    // apart from its rows is the whole of what they see.
    const body = report({ checks: [check('decode_passes', 1000, 1000, 'OK')], all_ok: false });
    expect(refused(body).join('\n')).toContain('all_ok is false but 0 of 1 checks did not pass');
  });

  it('refuses the same check twice', () => {
    const body = report({
      checks: [check('decode_passes', 1000, 1000, 'OK'), check('decode_passes', 1000, 1000, 'OK')],
    });
    expect(refused(body).join('\n')).toContain('"decode_passes" appears more than once');
  });

  it('refuses thresholds that leave no room for a warning', () => {
    const body = { ...report(), tolerance_pct: 9, warn_pct: 5 };
    expect(refused(body).join('\n')).toContain('so no gap can be a warning');
  });

  it('refuses a status this build does not know', () => {
    const body = report();
    (body.checks[0] as unknown as Record<string, unknown>).status = 'UNKNOWN';
    expect(refused(body).join('\n')).toContain('status');
  });

  it('refuses a report that claims to be available with no checks', () => {
    expect(refused({ ...report(), checks: [] }).join('\n')).toContain('checks');
  });
});
