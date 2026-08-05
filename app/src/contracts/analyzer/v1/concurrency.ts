import { z } from 'zod';

import type { Concurrency } from '../../../domain/run';
import type { SubjectResult } from '../../../domain/subject';
import {
  formatZodIssue,
  incompatiblePayload,
  nonNegativeCount,
  nonNegativeNumber,
  positiveCount,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const MAX_POINTS = 512;
const FLOAT_BOUND_RELATIVE_TOLERANCE = 1e-12;

const readySchema = z
  .object({
    schema_version: z.literal(1),
    meta: z
      .object({
        log_dir: wireIdentityString,
        request_count: nonNegativeCount,
        span_ms: nonNegativeNumber,
        bins: positiveCount,
        max_points: z.literal(MAX_POINTS),
        aggregation: z.literal('equal-width time-weighted mean'),
      })
      .strict(),
    t_ms: z.array(nonNegativeNumber).min(1).max(MAX_POINTS),
    active: z.array(nonNegativeNumber).min(1).max(MAX_POINTS),
    peak: nonNegativeCount,
    definitions: z
      .object({
        scope: z.string().trim().min(1),
        active: z.string().trim().min(1),
        t_ms: z.string().trim().min(1),
        peak: z.string().trim().min(1),
        binning: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

type ReadyWire = z.infer<typeof readySchema>;

export type ConcurrencyDecodeResult =
  | Extract<SubjectResult<'concurrency'>, { status: 'ready' }>
  | Extract<SubjectResult<'concurrency'>, { status: 'incompatible' }>;

function semanticIssues(wire: ReadyWire, options: AnalyzerV1PayloadDecodeOptions): string[] {
  const issues: string[] = [];
  const sourceIssue = sourceLogDirIssue(wire.meta.log_dir, options);
  if (sourceIssue) issues.push(sourceIssue);
  if (wire.t_ms.length !== wire.active.length) {
    issues.push(`active: has ${wire.active.length} points, expected ${wire.t_ms.length}`);
  }
  if (wire.t_ms.length !== wire.meta.bins) {
    issues.push(`meta.bins: declares ${wire.meta.bins}, received ${wire.t_ms.length} points`);
  }
  wire.t_ms.forEach((value, index) => {
    if (index > 0 && value <= wire.t_ms[index - 1]) {
      issues.push(`t_ms.${index}: values must be strictly increasing`);
    }
  });
  const last = wire.t_ms[wire.t_ms.length - 1];
  if (last !== wire.meta.span_ms) {
    issues.push(`t_ms.${wire.t_ms.length - 1}: must equal meta.span_ms (${wire.meta.span_ms})`);
  }
  const peakTolerance = Math.max(1e-9, wire.peak * FLOAT_BOUND_RELATIVE_TOLERANCE);
  wire.active.forEach((value, index) => {
    if (value > wire.peak + peakTolerance) {
      issues.push(`active.${index}: cannot exceed exact peak ${wire.peak}`);
    }
  });
  if (wire.peak > wire.meta.request_count) {
    issues.push(`peak: cannot exceed meta.request_count (${wire.meta.request_count})`);
  }
  return issues;
}

function toConcurrency(wire: ReadyWire): Concurrency {
  // Analyzer versions before the producer-side clamp can exceed an integer
  // peak by a few ULPs after area / bin-width division. Preserve compatibility
  // with those artifacts without exposing an impossible chart value.
  return {
    t_ms: [...wire.t_ms],
    active: wire.active.map((value) => Math.min(value, wire.peak)),
    peak: wire.peak,
  };
}

export function decodeAnalyzerV1ConcurrencyPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): ConcurrencyDecodeResult {
  const unsupported = unsupportedV1Payload('concurrency', input);
  if (unsupported) return { subject: 'concurrency', ...unsupported };
  const parsed = readySchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'concurrency',
      ...incompatiblePayload('concurrency', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const issues = semanticIssues(parsed.data, options);
  if (issues.length > 0) {
    return { subject: 'concurrency', ...incompatiblePayload('concurrency', issues, 1) };
  }
  return {
    subject: 'concurrency',
    status: 'ready',
    schemaVersion: 1,
    payload: toConcurrency(parsed.data),
  };
}
