import { describe, expect, it } from 'vitest';

import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import { buildPoolBatchSnapshots } from './poolBatchSnapshots';

const worker = (
  id: string,
  t_ms: number[],
  batchTokens: number[],
  prefillTokens: number[],
  decodeRequests: number[],
) => {
  const ref = makeWorkerRef('attn', id);
  return { key: makeWorkerKey(ref), worker: ref, t_ms, batchTokens, prefillTokens, decodeRequests };
};

describe('buildPoolBatchSnapshots', () => {
  it('holds each asynchronous worker value and emits complete-pool aggregate and average', () => {
    const snapshots = buildPoolBatchSnapshots([
      worker('0', [0, 20], [10, 14], [6, 8], [4, 6]),
      worker('1', [10, 30], [20, 24], [12, 14], [8, 10]),
    ]);

    expect(snapshots).not.toBeNull();
    expect(snapshots?.tMs).toEqual([10, 20, 30]);
    expect(snapshots?.aggregate.batchTokens).toEqual([30, 34, 38]);
    expect(snapshots?.average.batchTokens).toEqual([15, 17, 19]);
    expect(snapshots?.aggregate.prefillTokens).toEqual([18, 20, 22]);
    expect(snapshots?.aggregate.decodeRequests).toEqual([12, 14, 16]);
  });

  it('retains both ends when downsampling the merged snapshot timeline', () => {
    const snapshots = buildPoolBatchSnapshots(
      [worker('0', [0, 1, 2, 3, 4], [1, 2, 3, 4, 5], [0, 0, 0, 0, 0], [1, 2, 3, 4, 5])],
      3,
    );

    expect(snapshots?.tMs).toEqual([0, 2, 4]);
    expect(snapshots?.aggregate.batchTokens).toEqual([1, 3, 5]);
  });
});
