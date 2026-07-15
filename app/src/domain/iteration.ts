/**
 * Version-independent iteration facts returned by a future, bounded worker
 * detail endpoint. This module deliberately contains no generator or CostTree
 * reweighting: every value must originate in Analyzer evidence.
 */
export interface Iteration {
  readonly id: number;
  readonly timeMs: number;
  readonly prefillTokens: number;
  readonly decodeRequests: number;
  readonly batchTokens: number;
  readonly phase: 'prefill' | 'mixed' | 'decode';
}

export interface IterTimeline {
  readonly iters: readonly Iteration[];
  readonly spanMs: number;
}

/** Select the scheduler step nearest a wall-clock cursor without changing it. */
export function nearestIteration(timeline: IterTimeline, timeMs: number): Iteration | null {
  const iterations = timeline.iters;
  if (iterations.length === 0) return null;

  let lower = 0;
  let upper = iterations.length - 1;
  const first = iterations[lower];
  const last = iterations[upper];
  if (first === undefined || last === undefined) return null;
  if (timeMs <= first.timeMs) return first;
  if (timeMs >= last.timeMs) return last;

  while (lower < upper) {
    const middle = (lower + upper) >> 1;
    const candidate = iterations[middle];
    if (candidate === undefined) return null;
    if (candidate.timeMs < timeMs) lower = middle + 1;
    else upper = middle;
  }

  const higherIteration = iterations[lower];
  const lowerIteration = iterations[lower - 1];
  if (higherIteration === undefined || lowerIteration === undefined) return null;
  return timeMs - lowerIteration.timeMs <= higherIteration.timeMs - timeMs
    ? lowerIteration
    : higherIteration;
}
