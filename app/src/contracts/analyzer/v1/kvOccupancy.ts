import { z } from 'zod';

import type { KvSeries } from '../../../domain/run';
import type { SubjectResult } from '../../../domain/subject';
import {
  duplicateKeyIssues,
  formatZodIssue,
  incompatiblePayload,
  nonNegativeNumber,
  parallelLengthIssue,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const seriesSchema = z.object({
  active: z.object({ mean: z.array(nonNegativeNumber) }),
  capacity_tokens: nonNegativeNumber.positive().nullable(),
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    has_capacity: z.boolean(),
    log_dir: wireIdentityString,
    unit: z.literal('KV tokens (per shard); fraction = tokens / capacity_tokens'),
  }),
  t_start_ms: z.array(nonNegativeNumber).min(1),
  t_end_ms: z.array(nonNegativeNumber).min(1),
  series: z.array(seriesSchema).min(1),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  series: z.array(z.unknown()).length(0),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return 'available' in wire.meta && wire.meta.available === false;
}

export type KvOccupancyDecodeResult =
  | Extract<SubjectResult<'kv'>, { status: 'ready' }>
  | Extract<SubjectResult<'kv'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'kv'>, { status: 'incompatible' }>;

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('series', wire.series, (series) => series.key);
  const computedHasCapacity = wire.series.some((series) => series.capacity_tokens !== null);
  if (wire.meta.has_capacity !== computedHasCapacity) {
    issues.push(
      `meta.has_capacity: expected ${computedHasCapacity} from series capacity_tokens values`,
    );
  }
  const pointCount = wire.t_start_ms.length;
  const endLength = parallelLengthIssue('t_end_ms', pointCount, wire.t_end_ms);
  if (endLength) issues.push(endLength);
  wire.t_start_ms.forEach((start, index) => {
    if (wire.t_end_ms[index] !== undefined && wire.t_end_ms[index] <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
  });
  wire.series.forEach((series, index) => {
    const lengthIssue = parallelLengthIssue(
      `series.${index}.active.mean`,
      pointCount,
      series.active.mean,
    );
    if (lengthIssue) issues.push(lengthIssue);
  });
  return issues;
}

function toKvSeries(wire: ReadyWire): KvSeries {
  return {
    t_ms: wire.t_start_ms.map((start, index) => (start + wire.t_end_ms[index]) / 2),
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      capacity: series.capacity_tokens,
      // Do not clamp active/capacity: over-capacity values are diagnostics.
      active: [...series.active.mean],
    })),
  };
}

export function decodeAnalyzerV1KvOccupancyPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): KvOccupancyDecodeResult {
  const unsupported = unsupportedV1Payload('kv-occupancy', input);
  if (unsupported) return { subject: 'kv', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'kv',
      ...incompatiblePayload('kv-occupancy', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return { subject: 'kv', ...incompatiblePayload('kv-occupancy', [sourceIssue], 1) };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'kv', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return { subject: 'kv', ...incompatiblePayload('kv-occupancy', issues, 1) };
  }
  return {
    subject: 'kv',
    status: 'ready',
    schemaVersion: 1,
    payload: toKvSeries(wire),
  };
}
