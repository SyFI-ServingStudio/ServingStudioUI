/**
 * The two documents the run overview reads.
 *
 * They are decoded together because they are read together and nowhere else,
 * and because they disagree about almost everything else: the summary is the
 * simulator's own report and carries no schema version at all, while the
 * latency payload is an analyzer product that does. Naming every summary field
 * explicitly is what makes that missing version safe — a simulator that starts
 * writing a different document fails here, visibly, instead of rendering a
 * plausible number that means something else.
 *
 * The consistency checks are the ones the documents can actually settle among
 * themselves. `prefill + decode = total` is one of them. "Is the throughput
 * right" is not, and a check that recomputed it from the same fields would be a
 * check that cannot fail.
 */
import { z } from 'zod';

import type { LatencyMarkers, LatencySeries, RunLatency, RunSummary } from '../ref';

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();
const nonEmpty = z.string().min(1);

/** Raised when a body parses but says something impossible. */
export class IncompatibleRunOverviewError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`run overview payload is not readable:\n${issues.map((i) => `- ${i}`).join('\n')}`);
    this.name = 'IncompatibleRunOverviewError';
  }
}

/**
 * `strict`, unlike almost everything else read here.
 *
 * A stored conversation is history and grows fields the reader must tolerate.
 * This is not: it is written fresh by the simulator that produced the run, in
 * the same release, and an unrecognized field means the contract moved. Failing
 * on it is how that gets noticed while it is still one release old.
 */
const summarySchema = z
  .object({
    cause: nonEmpty,
    completed_req_s: nonNegative,
    decode_tok_s: nonNegative,
    decode_tokens: count,
    num_gpus: count.positive(),
    prefill_tok_s: nonNegative,
    prefill_tokens: count,
    realtime_x: nonNegative,
    requests_finished: count,
    requests_total: count,
    sim_ms: nonNegative,
    total_tok_s: nonNegative,
    total_tok_s_per_gpu: nonNegative,
    total_tokens: count,
    wall_s: nonNegative,
  })
  .strict();

export function parseRunSummary(body: unknown): RunSummary {
  const wire = summarySchema.parse(body);
  const issues: string[] = [];
  if (wire.requests_finished > wire.requests_total) {
    issues.push(
      `requests_finished (${wire.requests_finished}) exceeds requests_total (${wire.requests_total})`,
    );
  }
  if (wire.prefill_tokens + wire.decode_tokens !== wire.total_tokens) {
    issues.push(
      `prefill_tokens + decode_tokens (${wire.prefill_tokens + wire.decode_tokens}) does not equal total_tokens (${wire.total_tokens})`,
    );
  }
  if (issues.length > 0) throw new IncompatibleRunOverviewError(issues);
  return {
    cause: wire.cause,
    totalTokensPerSecond: wire.total_tok_s,
    totalTokensPerSecondPerGpu: wire.total_tok_s_per_gpu,
    prefillTokensPerSecond: wire.prefill_tok_s,
    decodeTokensPerSecond: wire.decode_tok_s,
    completedRequestsPerSecond: wire.completed_req_s,
    gpus: wire.num_gpus,
    requestsFinished: wire.requests_finished,
    requestsTotal: wire.requests_total,
    prefillTokens: wire.prefill_tokens,
    decodeTokens: wire.decode_tokens,
    totalTokens: wire.total_tokens,
    simulatedMs: wire.sim_ms,
    wallSeconds: wire.wall_s,
    realtimeFactor: wire.realtime_x,
  };
}

export const RUN_LATENCY_SCHEMA_VERSION = 1;

const markersSchema = z
  .union([
    z.object({ p50: nonNegative, p90: nonNegative, p99: nonNegative }),
    z.object({ p50: z.null(), p90: z.null(), p99: z.null() }),
  ])
  .transform<LatencyMarkers | null>((markers) => (markers.p50 === null ? null : markers));

/**
 * Passthrough, unlike the summary, and for the opposite reason.
 *
 * This payload carries the whole CDF — `x` is up to a thousand points — and the
 * run page draws it. Unknown producer metadata remains forward compatible, but
 * the columns the chart reads are named and checked below.
 */
const seriesSchema = z
  .object({
    key: nonEmpty,
    label: nonEmpty,
    unit: nonEmpty,
    n: count,
    markers: markersSchema,
    x: z.array(nonNegative),
    y_pct: z.array(finite),
  })
  .passthrough();

const latencySchema = z
  .object({
    schema_version: count,
    series: z.array(seriesSchema),
    definitions: z.record(z.string()).optional(),
  })
  .passthrough();

export function parseRunLatency(body: unknown): RunLatency {
  const received = (body as { schema_version?: unknown } | null)?.schema_version;
  if (received !== RUN_LATENCY_SCHEMA_VERSION) {
    throw new IncompatibleRunOverviewError(
      [
        `latency payload is schema ${String(received)}; this build reads ${RUN_LATENCY_SCHEMA_VERSION}`,
      ],
      typeof received === 'number' ? received : undefined,
    );
  }
  const parsed = latencySchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRunOverviewError(
      parsed.error.issues.map(
        (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
      ),
      received,
    );
  }
  const wire = parsed.data;
  const series: LatencySeries[] = wire.series.map((entry) => ({
    key: entry.key,
    label: entry.label,
    unit: entry.unit,
    count: entry.n,
    markers: entry.markers,
    x: entry.x,
    yPct: entry.y_pct,
  }));
  const issues = latencyIssues(series);
  if (issues.length > 0) throw new IncompatibleRunOverviewError(issues, wire.schema_version);
  return { series, definitions: wire.definitions ?? {} };
}

const EXPECTED_UNITS = { ttft: 'ms', tpot: 'ms/token', e2e: 'ms' } as const;

function latencyIssues(series: readonly LatencySeries[]): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const entry of series) {
    if (keys.has(entry.key)) issues.push(`series contains duplicate key ${entry.key}`);
    keys.add(entry.key);
  }
  for (const [key, unit] of Object.entries(EXPECTED_UNITS)) {
    const entry = series.find((candidate) => candidate.key === key);
    if (entry === undefined) {
      issues.push(`series is missing required ${key} series`);
    } else if (entry.unit !== unit) {
      issues.push(`${key} unit is ${entry.unit}; expected ${unit}`);
    }
  }
  for (const entry of series) {
    if (entry.x.length !== entry.yPct.length) {
      issues.push(`${entry.key} CDF columns have different lengths`);
    }
    if (entry.count < entry.x.length) {
      issues.push(`${entry.key} CDF has ${entry.x.length} points for only ${entry.count} samples`);
    }
    if (entry.count === 0) {
      if (entry.x.length > 0 || entry.yPct.length > 0 || entry.markers !== null) {
        issues.push(`${entry.key} has no samples but carries CDF values or markers`);
      }
      continue;
    }
    if (entry.x.length === 0 || entry.markers === null) {
      issues.push(`${entry.key} has samples but no CDF values or markers`);
      continue;
    }
    if (!nonDecreasing(entry.x)) issues.push(`${entry.key} latencies are not non-decreasing`);
    if (!nonDecreasing(entry.yPct)) issues.push(`${entry.key} CDF is not non-decreasing`);
    if (entry.yPct.some((value) => value < 0 || value > 100)) {
      issues.push(`${entry.key} CDF contains a percentage outside 0-100`);
    }
    if (entry.yPct.length > 0 && Math.abs(entry.yPct[entry.yPct.length - 1] - 100) > 1e-9) {
      issues.push(`${entry.key} CDF does not end at 100%`);
    }
    if (
      entry.x.length > 0 &&
      Object.values(entry.markers).some(
        (marker) => marker < entry.x[0] || marker > entry.x[entry.x.length - 1],
      )
    ) {
      issues.push(`${entry.key} markers fall outside the latency range`);
    }
    issues.push(...outOfOrder(entry));
  }
  return issues;
}

function nonDecreasing(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1] <= value);
}

/**
 * Percentiles that do not increase are not percentiles.
 *
 * Worth checking because the failure it catches is silent: three numbers that
 * look like latencies and are read as p50/p90/p99 by position. Nothing else in
 * the payload would give it away.
 */
function outOfOrder(entry: LatencySeries): string[] {
  if (entry.markers === null) return [];
  const { p50, p90, p99 } = entry.markers;
  if (p50 <= p90 && p90 <= p99) return [];
  return [`${entry.key} markers are not ordered: p50 ${p50}, p90 ${p90}, p99 ${p99}`];
}
