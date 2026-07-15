import type { BatchSeries, Run } from '../domain/run';
import type { WorkerKey } from '../domain/worker';
import { iterationsFor } from './iterations';

/** Worker composition must come from the worker-owned iteration stream so the
 * chart, iteration strip, and cost-tree selection share one source of truth. */
export function workerBatchFor(run: Run, workerKey: WorkerKey): BatchSeries {
  const timeline = iterationsFor(run, workerKey);
  return {
    t_ms: timeline.iters.map((iteration) => iteration.timeMs),
    batchTokens: timeline.iters.map((iteration) => iteration.batchTokens),
    prefillTokens: timeline.iters.map((iteration) => iteration.prefillTokens),
    decodeRequests: timeline.iters.map((iteration) => iteration.decodeRequests),
  };
}
