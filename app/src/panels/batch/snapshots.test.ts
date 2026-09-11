import { describe, expect, it } from 'vitest';

import type { BatchTimelineScope } from '../../artifacts';
import { buildPoolBatchSnapshots } from './snapshots';

function worker(id: string, timeMs: number[], batch: number[]): BatchTimelineScope {
  return {
    poolTag: 'decode',
    workerId: id,
    invocations: timeMs.length,
    plottedPoints: timeMs.length,
    timeMs,
    series: [
      { key: 'batch_tokens', label: 'Batch tokens', values: batch },
      { key: 'prefill_tokens', label: 'Prefill tokens', values: batch.map((value) => value - 1) },
      { key: 'decode_request_count', label: 'Decode requests', values: batch.map(() => 1) },
    ],
    averages: {},
  };
}

describe('pool batch snapshots', () => {
  it('holds each asynchronous worker sample until its next invocation', () => {
    const result = buildPoolBatchSnapshots([
      worker('0', [0, 20, 40], [10, 12, 14]),
      worker('1', [10, 30, 50], [20, 22, 24]),
    ]);

    expect(result?.aggregate.tMs).toEqual([10, 20, 30, 40, 50]);
    expect(result?.aggregate.batchTokens).toEqual([30, 32, 34, 36, 38]);
    expect(result?.average.batchTokens).toEqual([15, 16, 17, 18, 19]);
    expect(result?.workerCount).toBe(2);
  });

  it('waits until every worker has supplied its first value', () => {
    const result = buildPoolBatchSnapshots([worker('0', [0, 10], [1, 3]), worker('1', [10], [2])]);
    expect(result?.aggregate.tMs).toEqual([10]);
    expect(result?.aggregate.batchTokens).toEqual([5]);
  });

  it('returns null when the payload has no worker detail', () => {
    expect(buildPoolBatchSnapshots([])).toBeNull();
  });

  it('keeps the first and last snapshot when limiting a long series', () => {
    const times = Array.from({ length: 4_001 }, (_, index) => index);
    const result = buildPoolBatchSnapshots([worker('0', times, times)], 4_000);
    expect(result?.aggregate.tMs).toHaveLength(4_000);
    expect(result?.aggregate.tMs[0]).toBe(0);
    expect(result?.aggregate.tMs.at(-1)).toBe(4_000);
  });
});
