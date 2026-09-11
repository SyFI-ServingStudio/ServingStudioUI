/**
 * What the conservation projection decides.
 *
 * Two decisions. The rows are grouped by verdict, worst first, and inside each
 * group the producer's own order survives — which walks the run from prefill
 * through the prefix cache to decode. And the headline is the *worst* verdict
 * present rather than the report's `all_ok` boolean, because "something is
 * wrong" and "how wrong" are different sentences and the panel says the second.
 *
 * The fixture is five checks whose producer order is neither the severity order
 * nor its reverse, with two failures and two passes separated in that order, so
 * an implementation that sorted by severity without a stable sort — or that
 * sorted by name, or by the size of the gap — produces a different list.
 */
import { describe, expect, it } from 'vitest';

import { runConservation } from './checks';
import type { ConservationCheck, RunConservation } from '../../artifacts';

function check(
  name: string,
  status: ConservationCheck['status'],
  over: Partial<ConservationCheck> = {},
): ConservationCheck {
  const expected = 1000;
  const actual = status === 'ok' ? 1000 : status === 'warn' ? 1010 : 1400;
  return {
    name,
    description: `${name}: one side against the other`,
    expected,
    actual,
    delta: actual - expected,
    deltaPercent: ((actual - expected) / expected) * 100,
    status,
    allowance: null,
    unexplained: actual - expected,
    ...over,
  };
}

/**
 * Producer order `alpha(ok), bravo(fail), charlie(ok), delta(warn), echo(fail)`.
 *
 * Severity order is therefore `bravo, echo, delta, alpha, charlie` — a list
 * that is not the input order, not its reverse, and not alphabetical.
 */
function state(over: Partial<RunConservation> = {}): RunConservation {
  return {
    checks: [
      check('alpha', 'ok'),
      check('bravo', 'fail'),
      check('charlie', 'ok'),
      check('delta', 'warn'),
      check('echo', 'fail'),
    ],
    allOk: false,
    tolerancePercent: 0.01,
    warnPercent: 5,
    deployment: 'unified',
    requests: 512,
    iterations: 106435,
    definitions: {},
    ...over,
  };
}

function ready(projection: ReturnType<typeof runConservation>) {
  if (projection.status !== 'ready') {
    throw new Error(`expected a projection, got ${projection.status}`);
  }
  return projection.value;
}

describe('runConservation', () => {
  it('puts the failures first and keeps the producer’s order inside each group', () => {
    // Both halves in one list. Grouping alone would allow `echo, bravo`; the
    // producer's order alone would allow `alpha, bravo, charlie, delta, echo`.
    expect(ready(runConservation(state())).rows.map((row) => row.name)).toEqual([
      'bravo',
      'echo',
      'delta',
      'alpha',
      'charlie',
    ]);
  });

  it('leads with the worst verdict present, not with whether all passed', () => {
    // A run with one warning and a run with one failure both have `all_ok`
    // false, and they are not the same news.
    expect(ready(runConservation(state())).verdict).toBe('fail');
    expect(
      ready(runConservation(state({ checks: [check('delta', 'warn'), check('alpha', 'ok')] })))
        .verdict,
    ).toBe('warn');
    expect(ready(runConservation(state({ checks: [check('alpha', 'ok')] }))).verdict).toBe('ok');
  });

  it('does not take the report’s word for the verdict', () => {
    // `allOk` is the producer's summary and the rows are its evidence. The
    // schema refuses a report where they disagree, so this can only be reached
    // by a projection that read the wrong field — and it would then draw a
    // reassuring line over four failing checks.
    const value = ready(runConservation(state({ allOk: true })));
    expect(value.verdict).toBe('fail');
    expect(value.unreconciled).toBe(3);
  });

  it('counts what did not reconcile against how many were run', () => {
    const value = ready(runConservation(state()));
    expect(value.unreconciled).toBe(3);
    expect(value.total).toBe(5);
  });

  it('marks a check that expected nothing, which is the one with no percentage', () => {
    // The panel says "the workload implies none of this, and the log holds N"
    // rather than printing a gap with an empty percentage beside it.
    const none = check('prefix_hit_bounds', 'fail', {
      expected: 0,
      actual: 3,
      delta: 3,
      deltaPercent: null,
      unexplained: 3,
    });
    const row = ready(runConservation(state({ checks: [none] }))).rows[0];
    expect(row.expectedNone).toBe(true);
    expect(row.deltaPercent).toBeNull();
  });

  it('marks one that expected nothing and found nothing, which does have a percentage', () => {
    // The two conditions come apart here, and this is the common case: most
    // runs pass their "there should be none of this" checks, and a check that
    // expected zero and found zero has a percentage of zero, not a null. An
    // implementation that read the null instead of the expectation would agree
    // on every failing row and be wrong about every passing one.
    const clean = check('prefix_hit_bounds', 'ok', {
      expected: 0,
      actual: 0,
      delta: 0,
      deltaPercent: 0,
      unexplained: 0,
    });
    const row = ready(runConservation(state({ checks: [clean] }))).rows[0];
    expect(row.expectedNone).toBe(true);
    expect(row.deltaPercent).toBe(0);
  });

  it('does not mark an ordinary check as expecting nothing', () => {
    expect(ready(runConservation(state())).rows.every((row) => row.expectedNone)).toBe(false);
  });

  it('carries the allowance and the gap it leaves through to the row', () => {
    const tail = check('ffn_token_pass', 'ok', {
      actual: 1040,
      delta: 40,
      deltaPercent: 4,
      allowance: 40,
      unexplained: 0,
    });
    const row = ready(runConservation(state({ checks: [tail] }))).rows[0];
    expect(row.allowance).toBe(40);
    expect(row.unexplained).toBe(0);
    // And the raw gap, which is what the log actually holds.
    expect(row.delta).toBe(40);
  });

  it('carries what the checks were run against', () => {
    const value = ready(runConservation(state()));
    expect(value.deployment).toBe('unified');
    expect(value.requests).toBe(512);
    expect(value.iterations).toBe(106435);
    expect(value.tolerancePercent).toBe(0.01);
    expect(value.warnPercent).toBe(5);
  });
});
