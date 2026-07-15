import { z } from 'zod';

import type { UtilSeries } from '../../../domain/run';
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
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  // Values above one are preserved as analyzer diagnostics; negative busy time
  // has no physical meaning and remains a protocol error.
  util: z.array(nonNegativeNumber),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    unit: z.literal('fraction of pool workers busy (0-1)'),
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

export type UtilizationDecodeResult =
  | Extract<SubjectResult<'utilization'>, { status: 'ready' }>
  | Extract<SubjectResult<'utilization'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'utilization'>, { status: 'incompatible' }>;

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('series', wire.series, (series) => series.key);
  issues.push(...duplicateKeyIssues('series.pool_tag', wire.series, (series) => series.pool_tag));
  const pointCount = wire.t_start_ms.length;
  const endLength = parallelLengthIssue('t_end_ms', pointCount, wire.t_end_ms);
  if (endLength) issues.push(endLength);
  wire.t_start_ms.forEach((start, index) => {
    if (wire.t_end_ms[index] !== undefined && wire.t_end_ms[index] <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
  });
  wire.series.forEach((series, index) => {
    const lengthIssue = parallelLengthIssue(`series.${index}.util`, pointCount, series.util);
    if (lengthIssue) issues.push(lengthIssue);
  });
  return issues;
}

function toUtilization(wire: ReadyWire): UtilSeries {
  return {
    t_ms: wire.t_start_ms.map((start, index) => (start + wire.t_end_ms[index]) / 2),
    series: wire.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      util: [...series.util],
    })),
  };
}

export function decodeAnalyzerV1UtilizationPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): UtilizationDecodeResult {
  const unsupported = unsupportedV1Payload('utilization', input);
  if (unsupported) return { subject: 'utilization', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'utilization',
      ...incompatiblePayload('utilization', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return { subject: 'utilization', ...incompatiblePayload('utilization', [sourceIssue], 1) };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'utilization', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return { subject: 'utilization', ...incompatiblePayload('utilization', issues, 1) };
  }
  return {
    subject: 'utilization',
    status: 'ready',
    schemaVersion: 1,
    payload: toUtilization(wire),
  };
}
