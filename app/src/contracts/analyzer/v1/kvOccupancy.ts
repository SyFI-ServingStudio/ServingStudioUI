import { z } from 'zod';

import type { KvSeries } from '../../../domain/run';
import { makeWorkerKey, makeWorkerRef } from '../../../domain/worker';
import {
  duplicateKeyIssues,
  nonNegativeNumber,
  nonNegativeCount,
  parallelLengthIssue,
  wireIdentityString,
} from './subjectDecode';
import {
  defineAnalyzerV1PayloadDecoder,
  type AnalyzerV1PayloadDecodeResult,
} from './subjectEnvelope';

const workerIdSchema = z.union([
  wireIdentityString,
  nonNegativeCount.transform((workerId) => String(workerId)),
]);

const workerSchema = z.object({
  worker_id: workerIdSchema,
  active_tokens: z.array(nonNegativeNumber),
});

const seriesSchema = z.object({
  active: z.object({ mean: z.array(nonNegativeNumber) }),
  capacity_tokens: nonNegativeNumber.positive().nullable(),
  key: wireIdentityString,
  label: z.string().trim().min(1),
  pool_tag: wireIdentityString,
  // `workers` is additive within analyzer schema v1. Older artifacts still
  // expose the pool aggregate and decode to an empty worker collection.
  workers: z.array(workerSchema).default([]),
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

type ReadyWire = z.infer<typeof readySchema>;

export type KvOccupancyDecodeResult = AnalyzerV1PayloadDecodeResult<'kv'>;

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
    series.workers.forEach((worker, workerIndex) => {
      const workerLengthIssue = parallelLengthIssue(
        `series.${index}.workers.${workerIndex}.active_tokens`,
        pointCount,
        worker.active_tokens,
      );
      if (workerLengthIssue) issues.push(workerLengthIssue);
    });
  });
  const workers = wire.series.flatMap((series) =>
    series.workers.map((worker) => ({ poolTag: series.pool_tag, workerId: worker.worker_id })),
  );
  issues.push(
    ...duplicateKeyIssues('series.workers', workers, (worker) =>
      makeWorkerKey(worker.poolTag, worker.workerId),
    ),
  );
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
    workerSeries: wire.series.flatMap((series) =>
      series.workers.map((workerSeries) => {
        const worker = makeWorkerRef(series.pool_tag, workerSeries.worker_id);
        return {
          key: makeWorkerKey(worker),
          label: `${series.pool_tag}/${worker.workerId}`,
          worker,
          capacity: series.capacity_tokens,
          // Do not clamp active/capacity: over-capacity values are diagnostics.
          active: [...workerSeries.active_tokens],
        };
      }),
    ),
  };
}

export const decodeAnalyzerV1KvOccupancyPayload = defineAnalyzerV1PayloadDecoder({
  subject: 'kv',
  label: 'kv-occupancy',
  readySchema,
  unavailableSchema,
  semanticIssues,
  toPayload: toKvSeries,
});
