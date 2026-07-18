import { z } from 'zod';

import type { BatchSeries, BatchSubject } from '../../../domain/run';
import type { SubjectResult } from '../../../domain/subject';
import { makeWorkerKey, makeWorkerRef } from '../../../domain/worker';
import {
  duplicateKeyIssues,
  formatZodIssue,
  incompatiblePayload,
  nonDecreasingIssue,
  nonNegativeCount,
  nonNegativeNumber,
  parallelLengthIssue,
  positiveCount,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const valueSeriesSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  values: z.array(nonNegativeNumber),
});

const poolSchema = z.object({
  pool: wireIdentityString,
  num_calls: nonNegativeCount,
  plotted_points: positiveCount,
  time_ms: z.array(nonNegativeNumber).min(1),
  series: z.array(valueSeriesSchema).min(3),
});

const workerIdSchema = z.union([
  wireIdentityString,
  nonNegativeCount.transform((workerId) => String(workerId)),
]);

const workerSchema = poolSchema.omit({ pool: true }).extend({
  pool_tag: wireIdentityString,
  worker_id: workerIdSchema,
});

const readySchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(true),
  meta: z.object({ log_dir: wireIdentityString, num_calls: nonNegativeCount }),
  pools: z.array(poolSchema).min(1),
  // Additive schema-v1 field: older artifacts remain readable, but cannot
  // answer a worker-scoped batch query without this identity-preserving list.
  workers: z.array(workerSchema).default([]),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  pools: z.array(z.unknown()).length(0),
  workers: z.array(z.unknown()).length(0).optional(),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type PoolWire = z.infer<typeof poolSchema>;
type CompositionWire = Pick<PoolWire, 'time_ms' | 'series'>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return !('available' in wire) || wire.available !== true;
}

export type BatchDecodeResult =
  | Extract<SubjectResult<'batch'>, { status: 'ready' }>
  | Extract<SubjectResult<'batch'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'batch'>, { status: 'incompatible' }>;

const SERIES_KEYS = ['batch_tokens', 'prefill_tokens', 'decode_request_count'] as const;

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('pools', wire.pools, (pool) => pool.pool);
  wire.pools.forEach((pool, poolIndex) => {
    issues.push(
      ...duplicateKeyIssues(`pools.${poolIndex}.series`, pool.series, (series) => series.key),
    );
    if (pool.plotted_points !== pool.time_ms.length) {
      issues.push(
        `pools.${poolIndex}.plotted_points: expected ${pool.time_ms.length}, got ${pool.plotted_points}`,
      );
    }
    const timeOrder = nonDecreasingIssue(`pools.${poolIndex}.time_ms`, pool.time_ms);
    if (timeOrder) issues.push(timeOrder);
    const byKey = new Map(pool.series.map((series) => [series.key, series]));
    for (const key of SERIES_KEYS) {
      const series = byKey.get(key);
      if (series === undefined) {
        issues.push(`pools.${poolIndex}.series: missing required ${key} series`);
        continue;
      }
      const lengthIssue = parallelLengthIssue(
        `pools.${poolIndex}.series.${key}.values`,
        pool.time_ms.length,
        series.values,
      );
      if (lengthIssue) issues.push(lengthIssue);
    }
    // These fields are independent analyzer measurements. In particular, an AFD
    // FFN invocation carries an aggregated token batch while its attention-only
    // prefill/decode counters are both zero; no additive identity holds globally.
  });
  issues.push(
    ...duplicateKeyIssues('workers', wire.workers, (worker) =>
      makeWorkerKey(worker.pool_tag, worker.worker_id),
    ),
  );
  wire.workers.forEach((worker, workerIndex) => {
    issues.push(
      ...duplicateKeyIssues(`workers.${workerIndex}.series`, worker.series, (series) => series.key),
    );
    if (worker.plotted_points !== worker.time_ms.length) {
      issues.push(
        `workers.${workerIndex}.plotted_points: expected ${worker.time_ms.length}, got ${worker.plotted_points}`,
      );
    }
    const timeOrder = nonDecreasingIssue(`workers.${workerIndex}.time_ms`, worker.time_ms);
    if (timeOrder) issues.push(timeOrder);
    const byKey = new Map(worker.series.map((series) => [series.key, series]));
    for (const key of SERIES_KEYS) {
      const series = byKey.get(key);
      if (series === undefined) {
        issues.push(`workers.${workerIndex}.series: missing required ${key} series`);
        continue;
      }
      const lengthIssue = parallelLengthIssue(
        `workers.${workerIndex}.series.${key}.values`,
        worker.time_ms.length,
        series.values,
      );
      if (lengthIssue) issues.push(lengthIssue);
    }
  });
  const poolCallTotal = wire.pools.reduce((total, pool) => total + pool.num_calls, 0);
  if (poolCallTotal !== wire.meta.num_calls) {
    issues.push(`meta.num_calls: expected pool total ${poolCallTotal}, got ${wire.meta.num_calls}`);
  }
  return issues;
}

function toBatchSeries(pool: CompositionWire): BatchSeries {
  const byKey = new Map(pool.series.map((series) => [series.key, series.values]));
  return {
    t_ms: [...pool.time_ms],
    batchTokens: [...byKey.get('batch_tokens')!],
    prefillTokens: [...byKey.get('prefill_tokens')!],
    decodeRequests: [...byKey.get('decode_request_count')!],
  };
}

function toBatchSubject(wire: ReadyWire): BatchSubject {
  return {
    pools: Object.fromEntries(wire.pools.map((pool) => [pool.pool, toBatchSeries(pool)])),
    workers: wire.workers.map((worker) => {
      const ref = makeWorkerRef(worker.pool_tag, worker.worker_id);
      return {
        ...toBatchSeries(worker),
        key: makeWorkerKey(ref),
        worker: ref,
      };
    }),
  };
}

export function decodeAnalyzerV1BatchPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): BatchDecodeResult {
  const unsupported = unsupportedV1Payload('batch', input);
  if (unsupported) return { subject: 'batch', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'batch',
      ...incompatiblePayload('batch', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return { subject: 'batch', ...incompatiblePayload('batch', [sourceIssue], 1) };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'batch', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return { subject: 'batch', ...incompatiblePayload('batch', issues, 1) };
  }
  return {
    subject: 'batch',
    status: 'ready',
    schemaVersion: 1,
    payload: toBatchSubject(wire),
  };
}
