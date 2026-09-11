import { z } from 'zod';

import type { RunConcurrency } from '../ref';

export const CONCURRENCY_SCHEMA_VERSION = 1;
const MAX_POINTS = 512;
const RELATIVE_TOLERANCE = 1e-12;
const nonNegative = z.number().finite().nonnegative();
const count = z.number().int().nonnegative().safe();
const nonEmpty = z.string().min(1);
const definitionsSchema = z
  .object({
    scope: nonEmpty,
    active: nonEmpty,
    t_ms: nonEmpty,
    peak: nonEmpty,
    binning: nonEmpty,
  })
  .strict();

export class IncompatibleConcurrencyError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(
      `concurrency payload is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatibleConcurrencyError';
  }
}

export class UnavailableConcurrencyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableConcurrencyError';
  }
}

const unavailableSchema = z
  .object({
    schema_version: z.literal(CONCURRENCY_SCHEMA_VERSION),
    meta: z
      .object({
        log_dir: nonEmpty,
        available: z.literal(false),
        reason: nonEmpty,
      })
      .strict(),
    t_ms: z.array(z.unknown()).length(0),
    active: z.array(z.unknown()).length(0),
    peak: z.literal(0),
    definitions: definitionsSchema,
  })
  .strict();

const schema = z
  .object({
    schema_version: z.literal(CONCURRENCY_SCHEMA_VERSION),
    meta: z
      .object({
        log_dir: nonEmpty,
        request_count: count,
        span_ms: nonNegative,
        bins: count.positive(),
        max_points: z.literal(MAX_POINTS),
        aggregation: z.literal('equal-width time-weighted mean'),
      })
      .strict(),
    t_ms: z.array(nonNegative).min(1).max(MAX_POINTS),
    active: z.array(nonNegative).min(1).max(MAX_POINTS),
    peak: count,
    definitions: definitionsSchema,
  })
  .strict();

export function parseConcurrency(body: unknown): RunConcurrency {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) throw new UnavailableConcurrencyError(unavailable.data.meta.reason);
  const received = (body as { schema_version?: unknown } | null)?.schema_version;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleConcurrencyError(
      parsed.error.issues.map(
        (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
      ),
      typeof received === 'number' ? received : undefined,
    );
  }
  const wire = parsed.data;
  const issues: string[] = [];
  if (wire.t_ms.length !== wire.active.length) {
    issues.push(`active has ${wire.active.length} points; expected ${wire.t_ms.length}`);
  }
  if (wire.t_ms.length !== wire.meta.bins) {
    issues.push(`meta.bins declares ${wire.meta.bins}; received ${wire.t_ms.length} points`);
  }
  wire.t_ms.forEach((value, index) => {
    if (index > 0 && value <= wire.t_ms[index - 1]) {
      issues.push(`t_ms.${index} must be strictly increasing`);
    }
  });
  if (wire.t_ms[wire.t_ms.length - 1] !== wire.meta.span_ms) {
    issues.push(`last t_ms must equal meta.span_ms (${wire.meta.span_ms})`);
  }
  const edgeTolerance = Math.max(1e-9, wire.meta.span_ms * RELATIVE_TOLERANCE);
  wire.t_ms.forEach((value, index) => {
    const expected = (wire.meta.span_ms * (index + 1)) / wire.meta.bins;
    if (Math.abs(value - expected) > edgeTolerance) {
      issues.push(`t_ms.${index} must be the right edge of equal-width bin ${index}`);
    }
  });
  const peakTolerance = Math.max(1e-9, wire.peak * RELATIVE_TOLERANCE);
  wire.active.forEach((value, index) => {
    if (value > wire.peak + peakTolerance) {
      issues.push(`active.${index} cannot exceed exact peak ${wire.peak}`);
    }
  });
  if (wire.peak > wire.meta.request_count) {
    issues.push(`peak cannot exceed meta.request_count (${wire.meta.request_count})`);
  }
  if (issues.length > 0) {
    throw new IncompatibleConcurrencyError(issues, wire.schema_version);
  }
  return {
    tMs: wire.t_ms,
    active: wire.active.map((value) => Math.min(value, wire.peak)),
    peak: wire.peak,
    sourceLogDir: wire.meta.log_dir,
    requestCount: wire.meta.request_count,
    spanMs: wire.meta.span_ms,
    bins: wire.meta.bins,
    maxPoints: wire.meta.max_points,
    aggregation: wire.meta.aggregation,
    definitions: {
      scope: wire.definitions.scope,
      active: wire.definitions.active,
      tMs: wire.definitions.t_ms,
      peak: wire.definitions.peak,
      binning: wire.definitions.binning,
    },
  };
}
