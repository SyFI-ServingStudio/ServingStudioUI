import { z } from 'zod';

import type { UtilSeries } from '../../../domain/run';
import { makeWorkerKey, makeWorkerRef } from '../../../domain/worker';
import {
  duplicateKeyIssues,
  nonNegativeCount,
  nonNegativeNumber,
  parallelLengthIssue,
  wireIdentityString,
} from './subjectDecode';
import {
  defineAnalyzerV1PayloadDecoder,
  type AnalyzerV1PayloadDecodeResult,
} from './subjectEnvelope';

const seriesSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  // Values above one are preserved as analyzer diagnostics; negative busy time
  // has no physical meaning and remains a protocol error.
  util: z.array(nonNegativeNumber),
});

const workerIdSchema = z.union([
  wireIdentityString,
  nonNegativeCount.transform((workerId) => String(workerId)),
]);

const workerSeriesSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  worker_id: workerIdSchema,
  util: z.array(nonNegativeNumber),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    unit: z.literal('fraction of pool workers busy (0-1)'),
    worker_unit: z.literal('fraction of worker/GPU busy time (0-1)').optional(),
  }),
  t_start_ms: z.array(nonNegativeNumber).min(1),
  t_end_ms: z.array(nonNegativeNumber).min(1),
  series: z.array(seriesSchema).min(1),
  // worker_series is an additive schema-v1 field. Its default preserves
  // compatibility with analyzer runs generated before worker detail existed.
  worker_series: z.array(workerSeriesSchema).default([]),
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
  worker_series: z.array(z.unknown()).length(0).optional(),
});

type ReadyWire = z.infer<typeof readySchema>;

export type UtilizationDecodeResult = AnalyzerV1PayloadDecodeResult<'utilization'>;

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
  issues.push(...duplicateKeyIssues('worker_series', wire.worker_series, (series) => series.key));
  issues.push(
    ...duplicateKeyIssues('worker_series.worker', wire.worker_series, (series) =>
      makeWorkerKey(series.pool_tag, series.worker_id),
    ),
  );
  wire.worker_series.forEach((series, index) => {
    const lengthIssue = parallelLengthIssue(`worker_series.${index}.util`, pointCount, series.util);
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
    workerSeries: wire.worker_series.map((series) => {
      const worker = makeWorkerRef(series.pool_tag, series.worker_id);
      return {
        key: makeWorkerKey(worker),
        label: series.label,
        worker,
        util: [...series.util],
      };
    }),
  };
}

export const decodeAnalyzerV1UtilizationPayload = defineAnalyzerV1PayloadDecoder({
  subject: 'utilization',
  label: 'utilization',
  readySchema,
  unavailableSchema,
  semanticIssues,
  toPayload: toUtilization,
});
