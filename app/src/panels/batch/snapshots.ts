import type { BatchTimelineScope } from '../../artifacts';
import { batchChartSeries, type BatchChartSeries } from './option';

export interface PoolBatchSnapshots {
  readonly aggregate: BatchChartSeries;
  readonly average: BatchChartSeries;
  readonly workerCount: number;
}

type BatchValues = readonly [number, number, number];
interface BatchEvent {
  readonly tMs: number;
  readonly workerIndex: number;
  readonly values: BatchValues;
}

/**
 * Reconstruct the same wall-clock pool snapshots as the existing UI.
 *
 * `workersPerReplica` is the topology's count of workers one replica runs on.
 * The stages of a `pp` pipeline each run the same microbatches, so the sum over
 * a pool's workers holds every token once per stage; the aggregate divides it
 * back to once per pipeline. Where a replica is one worker it is the plain sum.
 * The average stays per worker: one stage's batch is the pipeline's microbatch.
 */
export function buildPoolBatchSnapshots(
  workers: readonly BatchTimelineScope[],
  {
    workersPerReplica = 1,
    maxPoints = 4000,
  }: { workersPerReplica?: number; maxPoints?: number } = {},
): PoolBatchSnapshots | null {
  if (workers.length === 0) return null;
  const projected = workers.map(batchChartSeries);
  const events: BatchEvent[] = projected.flatMap((worker, workerIndex) =>
    worker.tMs.map((tMs, index) => ({
      tMs,
      workerIndex,
      values: [
        worker.batchTokens[index],
        worker.prefillTokens[index],
        worker.decodeRequests[index],
      ],
    })),
  );
  events.sort((left, right) => left.tMs - right.tMs || left.workerIndex - right.workerIndex);

  const latest: Array<BatchValues | undefined> = Array.from({ length: workers.length });
  let observedWorkers = 0;
  const times: number[] = [];
  const values: BatchValues[] = [];
  for (let index = 0; index < events.length;) {
    const time = events[index].tMs;
    while (index < events.length && events[index].tMs === time) {
      const event = events[index];
      if (latest[event.workerIndex] === undefined) observedWorkers += 1;
      latest[event.workerIndex] = event.values;
      index += 1;
    }
    if (observedWorkers !== workers.length) continue;
    times.push(time);
    values.push(
      latest.reduce<BatchValues>(
        (sum, value) => [
          sum[0] + (value?.[0] ?? 0),
          sum[1] + (value?.[1] ?? 0),
          sum[2] + (value?.[2] ?? 0),
        ],
        [0, 0, 0],
      ),
    );
  }

  const retained = retainedIndices(times.length, Math.max(1, maxPoints));
  const series = (divisor: number): BatchChartSeries => ({
    tMs: retained.map((index) => times[index]),
    batchTokens: retained.map((index) => values[index][0] / divisor),
    prefillTokens: retained.map((index) => values[index][1] / divisor),
    decodeRequests: retained.map((index) => values[index][2] / divisor),
  });
  return {
    aggregate: series(workersPerReplica),
    average: series(workers.length),
    workerCount: workers.length,
  };
}

function retainedIndices(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  if (limit <= 1) return [length - 1];
  return Array.from({ length: limit }, (_, index) =>
    Math.round((index * (length - 1)) / (limit - 1)),
  );
}
