import { z } from 'zod';

import type { RequestState } from '../../../domain/run';
import type { SubjectResult } from '../../../domain/subject';
import { makeWorkerRef } from '../../../domain/worker';
import {
  duplicateKeyIssues,
  formatZodIssue,
  incompatiblePayload,
  nonNegativeNumber,
  parallelLengthIssue,
  positiveCount,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const workerIdSchema = z.union([
  wireIdentityString,
  z.number().int().nonnegative().safe().transform(String),
]);

const categorySchema = z.object({
  category: wireIdentityString,
  values: z.array(nonNegativeNumber),
});

const workerSchema = z.object({
  worker_id: workerIdSchema,
  pending: z.array(nonNegativeNumber),
  series: z.array(categorySchema).min(1),
});

const poolSchema = z.object({
  pool: z.number().int().nonnegative().safe(),
  pool_tag: wireIdentityString,
  n_workers: positiveCount,
  total_pending: z.array(nonNegativeNumber),
  average_pending: z.array(nonNegativeNumber),
  workers: z.array(workerSchema),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({ log_dir: wireIdentityString }),
  t_start_ms: z.array(nonNegativeNumber).min(1),
  t_end_ms: z.array(nonNegativeNumber).min(1),
  cluster_series: z.array(categorySchema).min(1),
  pools: z.array(poolSchema),
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
  cluster_series: z.array(z.unknown()).length(0),
  pools: z.array(z.unknown()).length(0),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return 'available' in wire.meta && wire.meta.available === false;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues(
    'cluster_series.category',
    wire.cluster_series,
    (series) => series.category,
  );
  const pointCount = wire.t_start_ms.length;
  const endLength = parallelLengthIssue('t_end_ms', pointCount, wire.t_end_ms);
  if (endLength) issues.push(endLength);
  wire.t_start_ms.forEach((start, index) => {
    const end = wire.t_end_ms[index];
    if (end !== undefined && end <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
    if (index > 0 && start !== wire.t_end_ms[index - 1]) {
      issues.push(`t_start_ms.${index}: must equal the previous bin end`);
    }
  });
  wire.cluster_series.forEach((series, index) => {
    const issue = parallelLengthIssue(`cluster_series.${index}.values`, pointCount, series.values);
    if (issue) issues.push(issue);
  });
  issues.push(...duplicateKeyIssues('pools.pool_tag', wire.pools, (pool) => pool.pool_tag));
  issues.push(...duplicateKeyIssues('pools.pool', wire.pools, (pool) => String(pool.pool)));
  wire.pools.forEach((pool, poolIndex) => {
    for (const [field, values] of [
      ['total_pending', pool.total_pending],
      ['average_pending', pool.average_pending],
    ] as const) {
      const issue = parallelLengthIssue(`pools.${poolIndex}.${field}`, pointCount, values);
      if (issue) issues.push(issue);
    }
    if (pool.workers.length !== pool.n_workers) {
      issues.push(
        `pools.${poolIndex}.workers: expected ${pool.n_workers}, got ${pool.workers.length}`,
      );
    }
    issues.push(
      ...duplicateKeyIssues(
        `pools.${poolIndex}.workers.worker_id`,
        pool.workers,
        (worker) => worker.worker_id,
      ),
    );
    pool.workers.forEach((worker, workerIndex) => {
      const issue = parallelLengthIssue(
        `pools.${poolIndex}.workers.${workerIndex}.pending`,
        pointCount,
        worker.pending,
      );
      if (issue) issues.push(issue);
      issues.push(
        ...duplicateKeyIssues(
          `pools.${poolIndex}.workers.${workerIndex}.series.category`,
          worker.series,
          (series) => series.category,
        ),
      );
      worker.series.forEach((series, seriesIndex) => {
        const seriesIssue = parallelLengthIssue(
          `pools.${poolIndex}.workers.${workerIndex}.series.${seriesIndex}.values`,
          pointCount,
          series.values,
        );
        if (seriesIssue) issues.push(seriesIssue);
      });
      const pendingSeries = worker.series.find((series) => series.category === 'pending');
      if (
        pendingSeries === undefined ||
        pendingSeries.values.some((value, index) => value !== worker.pending[index])
      ) {
        issues.push(
          `pools.${poolIndex}.workers.${workerIndex}.pending: must equal the pending category series`,
        );
      }
    });
  });
  return issues;
}

function toRequestState(wire: ReadyWire): RequestState {
  return {
    tStartMs: [...wire.t_start_ms],
    tEndMs: [...wire.t_end_ms],
    clusterSeries: wire.cluster_series.map((series) => ({
      category: series.category,
      values: [...series.values],
    })),
    pools: wire.pools.map((pool) => ({
      poolTag: pool.pool_tag,
      workerCount: pool.n_workers,
      totalPending: [...pool.total_pending],
      averagePending: [...pool.average_pending],
      workers: pool.workers.map((worker) => ({
        worker: makeWorkerRef(pool.pool_tag, worker.worker_id),
        pending: [...worker.pending],
        series: worker.series.map((series) => ({
          category: series.category,
          values: [...series.values],
        })),
      })),
    })),
  };
}

export type RequestStateDecodeResult =
  | Extract<SubjectResult<'requestState'>, { status: 'ready' }>
  | Extract<SubjectResult<'requestState'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'requestState'>, { status: 'incompatible' }>;

export function decodeAnalyzerV1RequestStatePayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): RequestStateDecodeResult {
  const unsupported = unsupportedV1Payload('requestState', input);
  if (unsupported) return { subject: 'requestState', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'requestState',
      ...incompatiblePayload('requestState', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return { subject: 'requestState', ...incompatiblePayload('requestState', [sourceIssue], 1) };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'requestState', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return { subject: 'requestState', ...incompatiblePayload('requestState', issues, 1) };
  }
  return {
    subject: 'requestState',
    status: 'ready',
    schemaVersion: 1,
    payload: toRequestState(wire),
  };
}
