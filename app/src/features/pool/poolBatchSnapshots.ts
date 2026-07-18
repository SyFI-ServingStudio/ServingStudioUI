import type { BatchSeries, BatchSubject } from '../../domain/run';

export interface PoolBatchSnapshots {
  readonly tMs: readonly number[];
  readonly aggregate: BatchSeries;
  readonly average: BatchSeries;
  readonly workerCount: number;
}

type WorkerBatchSeries = BatchSubject['workers'][number];
type BatchValues = readonly [batchTokens: number, prefillTokens: number, decodeRequests: number];

interface BatchEvent {
  readonly tMs: number;
  readonly workerIndex: number;
  readonly values: BatchValues;
}

const MAX_POOL_SNAPSHOT_POINTS = 4000;

function retainedIndices(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  if (limit <= 1) return [length - 1];
  return Array.from({ length: limit }, (_, index) =>
    Math.round((index * (length - 1)) / (limit - 1)),
  );
}

/**
 * Reconstructs a pool snapshot from asynchronous worker samples. Each worker's
 * latest invocation value is held until its next sample. Output starts only
 * after every worker has supplied an initial value, so aggregate and average
 * always describe the complete selected pool rather than a changing subset.
 */
export function buildPoolBatchSnapshots(
  workers: readonly WorkerBatchSeries[],
  maxPoints = MAX_POOL_SNAPSHOT_POINTS,
): PoolBatchSnapshots | null {
  if (workers.length === 0) return null;

  const events: BatchEvent[] = workers.flatMap((worker, workerIndex) =>
    worker.t_ms.map((tMs, sampleIndex) => ({
      tMs,
      workerIndex,
      values: [
        worker.batchTokens[sampleIndex],
        worker.prefillTokens[sampleIndex],
        worker.decodeRequests[sampleIndex],
      ],
    })),
  );
  events.sort((left, right) => left.tMs - right.tMs || left.workerIndex - right.workerIndex);

  const latest: Array<BatchValues | undefined> = Array.from({ length: workers.length });
  let observedWorkers = 0;
  const tMs: number[] = [];
  const aggregateValues: BatchValues[] = [];

  for (let eventIndex = 0; eventIndex < events.length;) {
    const snapshotTime = events[eventIndex].tMs;
    while (eventIndex < events.length && events[eventIndex].tMs === snapshotTime) {
      const event = events[eventIndex];
      if (latest[event.workerIndex] === undefined) observedWorkers += 1;
      latest[event.workerIndex] = event.values;
      eventIndex += 1;
    }
    if (observedWorkers !== workers.length) continue;

    const aggregate = latest.reduce<BatchValues>(
      (sum, values) => [
        sum[0] + (values?.[0] ?? 0),
        sum[1] + (values?.[1] ?? 0),
        sum[2] + (values?.[2] ?? 0),
      ],
      [0, 0, 0],
    );
    tMs.push(snapshotTime);
    aggregateValues.push(aggregate);
  }

  const indices = retainedIndices(tMs.length, Math.max(1, maxPoints));
  const selectedTimes = indices.map((index) => tMs[index]);
  const series = (divisor: number): BatchSeries => ({
    t_ms: selectedTimes,
    batchTokens: indices.map((index) => aggregateValues[index][0] / divisor),
    prefillTokens: indices.map((index) => aggregateValues[index][1] / divisor),
    decodeRequests: indices.map((index) => aggregateValues[index][2] / divisor),
  });

  return {
    tMs: selectedTimes,
    aggregate: series(1),
    average: series(workers.length),
    workerCount: workers.length,
  };
}
