/**
 * Whether the run's own logs add up, schema 1 — the `report`.
 *
 * Twelve identities, each restating one quantity two ways: what the workload
 * implies against what the log recorded. Tokens prefilled against tokens the
 * requests asked for. Decode forward passes against output tokens minus one.
 * The cost log's batch column against its own prefill and decode columns.
 *
 * This is the subject every other subject rests on. A KV occupancy chart drawn
 * over a log whose token totals do not reconcile is a confident picture of a
 * run that did not happen, and nothing else on the page can tell a reader that.
 *
 * ## The status is the verdict, and the percentage is not
 *
 * `delta_pct` is `delta / expected`, the *raw* gap. `status` is decided on the
 * **unexplained** gap — the producer subtracts an allowance first, where one
 * applies: a run stopped by the clock can leave one decode token partway
 * through the layer pipeline, and that much surplus is expected. So a check can
 * read three percent and still be `OK`, and a panel that coloured or ranked by
 * the percentage would contradict the producer about its own conclusion.
 *
 * The allowance is positive-only. A *shortfall* is never absorbed by it, which
 * is the asymmetry that makes it safe: work that is missing is missing.
 *
 * ## The most serious result is the one with no number
 *
 * Several checks are of the form "there should be none of this" — requests
 * whose prefix-cache hit exceeds what they declared, context-ready requests
 * with no admission-time observation. Their `expected` is zero, so a gap has no
 * percentage: the producer publishes an infinity, which does not survive JSON,
 * and the field arrives as `null`. That is the check that found something,
 * every time. A panel sorting by the percentage would put it last or drop it,
 * so this parser hands the panel a status and lets it lead with that.
 *
 * ## What is checked
 *
 * The producer's own arithmetic, so the panel can rely on it rather than
 * recomputing it in a second place that can disagree:
 *
 * - `delta = actual - expected`.
 * - `delta_pct` is that over `expected`, and is null exactly when `expected` is
 *   zero and `delta` is not.
 * - `status` follows the unexplained gap against the two published thresholds.
 *   This is the load-bearing one: the panel prints the status and nothing else
 *   would notice if it stopped meaning what it says.
 * - `all_ok` agrees with the rows it summarises.
 *
 * Everything here is a pure function of a parsed body.
 */
import { z } from 'zod';

import type { ConservationCheck, ConservationStatus, RunConservation } from '../ref';

export const CONSERVATION_SCHEMA_VERSION = 1;

/**
 * How far a republished figure may miss by.
 *
 * These are integer counts summed in `f64` and divided once. Relative only:
 * the quantities are sums of non-negative counts, so there is no cancellation,
 * and a difference that should be zero is exactly zero.
 */
const RELATIVE_TOLERANCE = 1e-9;

/** Raised when the body parses but says something impossible. */
export class IncompatibleConservationError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`conservation report is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleConservationError';
  }
}

/** Raised when the analysis says it has nothing. */
export class UnavailableConservationError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableConservationError';
  }
}

const nonEmpty = z.string().min(1);
const finite = z.number().finite();

const checkSchema = z
  .object({
    name: nonEmpty,
    description: nonEmpty,
    expected: finite,
    actual: finite,
    delta: finite,
    // Null where `expected` is zero: a percentage of nothing. See the header.
    delta_pct: finite.nullable(),
    status: z.enum(['OK', 'WARN', 'FAIL']),
    // Written only where one applies, which is why they are optional rather
    // than nullable — the producer omits the keys entirely.
    positive_boundary_allowance: finite.nonnegative().optional(),
    unexplained_delta: finite.optional(),
    unexplained_delta_pct: finite.nullable().optional(),
  })
  .strict();

const reportSchema = z.object({
  schema_version: z.literal(CONSERVATION_SCHEMA_VERSION),
  available: z.literal(true),
  meta: z
    .object({
      deployment: nonEmpty,
      num_requests: z.number().nonnegative(),
      num_iterations: z.number().nonnegative(),
    })
    .passthrough(),
  all_ok: z.boolean(),
  tolerance_pct: finite.nonnegative(),
  warn_pct: finite.nonnegative(),
  checks: z.array(checkSchema).nonempty(),
  definitions: z.record(nonEmpty),
});

const unavailableSchema = z.object({
  schema_version: z.literal(CONSERVATION_SCHEMA_VERSION),
  available: z.literal(false),
  reason: nonEmpty,
});

/** The version the body claims, when it claims one at all. */
export function conservationVersion(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null || !('schema_version' in body)) return undefined;
  const version = (body as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function parseConservation(body: unknown): RunConservation {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableConservationError(unavailable.data.reason);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleConservationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      conservationVersion(body),
    );
  }
  const wire = parsed.data;
  const issues = reportIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleConservationError(issues, CONSERVATION_SCHEMA_VERSION);
  }
  return {
    checks: wire.checks.map(checkOf),
    allOk: wire.all_ok,
    tolerancePercent: wire.tolerance_pct,
    warnPercent: wire.warn_pct,
    deployment: wire.meta.deployment,
    requests: wire.meta.num_requests,
    iterations: wire.meta.num_iterations,
    definitions: wire.definitions,
  };
}

type Wire = z.infer<typeof reportSchema>;
type WireCheck = z.infer<typeof checkSchema>;

const STATUS: Readonly<Record<WireCheck['status'], ConservationStatus>> = {
  OK: 'ok',
  WARN: 'warn',
  FAIL: 'fail',
};

function checkOf(check: WireCheck): ConservationCheck {
  return {
    name: check.name,
    description: check.description,
    expected: check.expected,
    actual: check.actual,
    delta: check.delta,
    deltaPercent: check.delta_pct,
    status: STATUS[check.status],
    allowance: check.positive_boundary_allowance ?? null,
    unexplained: unexplainedOf(check),
  };
}

/** The gap the allowance does not cover — what the status was decided on. */
function unexplainedOf(check: WireCheck): number {
  if (check.unexplained_delta !== undefined) return check.unexplained_delta;
  // No allowance published means none applied, and then the unexplained gap is
  // the gap. Derived rather than defaulted to zero: zero would say every check
  // reconciles, on the field the panel uses to say how far off one is.
  return check.delta;
}

function near(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= RELATIVE_TOLERANCE * scale;
}

function reportIssues(wire: Wire): string[] {
  const issues: string[] = [];

  if (wire.tolerance_pct > wire.warn_pct) {
    issues.push(
      `tolerance_pct ${wire.tolerance_pct} is above warn_pct ${wire.warn_pct}, so no gap can be a warning`,
    );
  }

  const seen = new Set<string>();
  for (const check of wire.checks) {
    if (seen.has(check.name)) issues.push(`checks: "${check.name}" appears more than once`);
    seen.add(check.name);
    issues.push(...checkIssues(check, wire.tolerance_pct, wire.warn_pct));
  }

  // The summary against the rows it summarises. The panel leads with one line
  // and the reader scrolls to the rows only when that line is bad, so a summary
  // that disagreed with them would be the whole of what most readers saw.
  const rowsOk = wire.checks.every((check) => check.status === 'OK');
  if (wire.all_ok !== rowsOk) {
    issues.push(
      `all_ok is ${wire.all_ok} but ${wire.checks.filter((check) => check.status !== 'OK').length} of ${wire.checks.length} checks did not pass`,
    );
  }

  return issues;
}

function checkIssues(check: WireCheck, tolerance: number, warn: number): readonly string[] {
  const issues: string[] = [];
  const at = `checks.${check.name}`;

  if (!near(check.delta, check.actual - check.expected)) {
    issues.push(
      `${at}: delta is ${check.delta}, but actual minus expected is ${check.actual - check.expected}`,
    );
  }

  // The percentage, and the one case there is none. Both directions: a null
  // where a number belongs hides a gap the reader could have sized, and a
  // number where a null belongs is a percentage of zero.
  const hasPercent = check.expected !== 0;
  if (hasPercent) {
    if (check.delta_pct === null) {
      issues.push(
        `${at}: delta_pct is absent, but expected ${check.expected} is a number to divide by`,
      );
    } else if (!near(check.delta_pct, (check.delta / check.expected) * 100)) {
      issues.push(
        `${at}: delta_pct is ${check.delta_pct}, but ${check.delta} of ${check.expected} is ${(check.delta / check.expected) * 100}`,
      );
    }
  } else if (check.delta !== 0 && check.delta_pct !== null) {
    issues.push(
      `${at}: delta_pct is ${check.delta_pct}, but nothing was expected and ${check.delta} of nothing has no percentage`,
    );
  }

  // The allowance and the gap it leaves are written together or not at all.
  const allowance = check.positive_boundary_allowance;
  if ((allowance === undefined) !== (check.unexplained_delta === undefined)) {
    issues.push(`${at}: an allowance and the gap it leaves are published together or not at all`);
  }
  if (allowance !== undefined && check.unexplained_delta !== undefined) {
    // Positive-only, and never larger than the gap it explains. A shortfall
    // absorbed by an allowance would be missing work reported as expected.
    const covered = check.delta > 0 ? Math.max(check.delta - allowance, 0) : check.delta;
    if (!near(check.unexplained_delta, covered)) {
      issues.push(
        `${at}: an allowance of ${allowance} against a gap of ${check.delta} leaves ${covered}, not ${check.unexplained_delta}`,
      );
    }
  }

  // The verdict against the thresholds it was decided by. Everything the panel
  // prints hangs off this field, and it is the one figure in the document that
  // nothing else would contradict if it were wrong.
  const unexplained = unexplainedOf(check);
  const percent =
    check.expected !== 0
      ? Math.abs((unexplained / check.expected) * 100)
      : unexplained === 0
        ? 0
        : Number.POSITIVE_INFINITY;
  const implied = percent <= tolerance ? 'OK' : percent <= warn ? 'WARN' : 'FAIL';
  if (implied !== check.status) {
    issues.push(
      `${at}: says ${check.status}, but an unexplained gap of ${unexplained} against ${check.expected} is ${implied} at these thresholds`,
    );
  }

  return issues;
}
