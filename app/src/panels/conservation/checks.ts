/**
 * Whether to believe the rest of the page.
 *
 * Twelve identities, each restating one quantity two ways. They are not a
 * ranking and they are not a chart: each one either reconciles or does not, and
 * what a reader needs is the worst answer first and the evidence under it.
 *
 * ## Ordered by verdict, and not otherwise
 *
 * Failures, then warnings, then the rest — and inside each group, the order the
 * producer wrote them in, which walks the run from prefill through the prefix
 * cache to decode and the attention work. Sorting by the size of the gap would
 * be comparing 654,848 tokens against 268,697,600 token-steps: different
 * quantities in different units, where the larger number is the one with the
 * larger unit.
 *
 * ## The status leads, because the percentage cannot
 *
 * A check whose expectation is zero — "no request should have hit more prefix
 * cache than it declared" — has no percentage when it finds one that did. The
 * producer publishes an infinity and JSON carries it as null. That is the most
 * serious result in the document and the one with an empty percentage column,
 * so the percentage is never what decides an order or a colour here.
 */
import type { ConservationCheck, ConservationStatus, RunConservation } from '../../artifacts';

/** Worst first. The producer's own order is kept inside each group. */
const SEVERITY: Readonly<Record<ConservationStatus, number>> = { fail: 0, warn: 1, ok: 2 };

export interface CheckRow {
  readonly name: string;
  /** The producer's sentence, which names both sides of the identity. */
  readonly description: string;
  readonly status: ConservationStatus;
  readonly expected: number;
  readonly actual: number;
  readonly delta: number;
  readonly deltaPercent: number | null;
  /**
   * True when the workload implied none of this at all.
   *
   * The panel says "expected none, found N" rather than printing a gap with no
   * percentage beside it — the absence of a number here is not missing data,
   * it is what a proportion of zero is.
   */
  readonly expectedNone: boolean;
  /** The part of a surplus the producer already accounts for, or `null`. */
  readonly allowance: number | null;
  /** The gap the allowance does not cover, which is what `status` was on. */
  readonly unexplained: number;
}

export interface Conservation {
  /** The worst verdict among the checks: what the panel leads with. */
  readonly verdict: ConservationStatus;
  readonly rows: readonly CheckRow[];
  /** How many did not pass, and how many there were. */
  readonly unreconciled: number;
  readonly total: number;
  readonly tolerancePercent: number;
  readonly warnPercent: number;
  /** Which family of formulas the expectations came from. */
  readonly deployment: string;
  readonly requests: number;
  readonly iterations: number;
}

/**
 * Always ready.
 *
 * A run-scoped subject has no pool or worker to fail to find, so unlike the
 * panels that descend there is no arm here for "this run has no such scope".
 * The shape is kept so the panel reads the same as its neighbours.
 */
export type ConservationProjection = { readonly status: 'ready'; readonly value: Conservation };

export function runConservation(state: RunConservation): ConservationProjection {
  const rows = ordered(state.checks);
  return {
    status: 'ready',
    value: {
      // The worst status present, not `allOk`. "Something is wrong" and "how
      // wrong" are different sentences and the panel says the second.
      verdict: rows.reduce<ConservationStatus>(
        (worst, row) => (SEVERITY[row.status] < SEVERITY[worst] ? row.status : worst),
        'ok',
      ),
      rows,
      unreconciled: rows.filter((row) => row.status !== 'ok').length,
      total: rows.length,
      tolerancePercent: state.tolerancePercent,
      warnPercent: state.warnPercent,
      deployment: state.deployment,
      requests: state.requests,
      iterations: state.iterations,
    },
  };
}

function ordered(checks: readonly ConservationCheck[]): CheckRow[] {
  // A stable sort on severity alone, so the producer's order survives inside
  // each group. Index-breaking the tie would say the same thing more loudly;
  // `Array.prototype.sort` has been stable since ES2019 and the two rules
  // together would be one rule written twice.
  return [...checks]
    .sort((left, right) => SEVERITY[left.status] - SEVERITY[right.status])
    .map(rowOf);
}

function rowOf(check: ConservationCheck): CheckRow {
  return {
    name: check.name,
    description: check.description,
    status: check.status,
    expected: check.expected,
    actual: check.actual,
    delta: check.delta,
    deltaPercent: check.deltaPercent,
    expectedNone: check.expected === 0,
    allowance: check.allowance,
    unexplained: check.unexplained,
  };
}
