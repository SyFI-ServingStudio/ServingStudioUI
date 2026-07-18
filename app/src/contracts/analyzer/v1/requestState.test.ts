import { describe, expect, it } from 'vitest';

import { makeWorkerRef } from '../../../domain/worker';
import { decodeAnalyzerV1RequestStatePayload } from './requestState';

function payload(): Record<string, unknown> {
  return {
    schema_version: 1,
    meta: { log_dir: 'logs/request-state' },
    t_start_ms: [0, 5],
    t_end_ms: [5, 10],
    cluster_series: [
      { category: 'pending', values: [2, 1] },
      { category: 'active', values: [1, 2] },
      { category: 'done', values: [0, 1] },
    ],
    pools: [
      {
        pool: 0,
        pool_tag: 'attn',
        n_workers: 1,
        total_pending: [2, 1],
        average_pending: [2, 1],
        workers: [
          {
            worker_id: 0,
            pending: [2, 1],
            series: [
              { category: 'pending', values: [2, 1] },
              { category: 'active', values: [1, 2] },
              { category: 'done', values: [0, 1] },
            ],
          },
        ],
      },
    ],
  };
}

describe('decodeAnalyzerV1RequestStatePayload', () => {
  it('preserves open category names and compound worker identity', () => {
    const result = decodeAnalyzerV1RequestStatePayload(payload(), {
      expectedLogDir: 'logs/request-state',
    });

    expect(result).toMatchObject({ status: 'ready', schemaVersion: 1 });
    if (result.status !== 'ready') throw new Error('expected ready request-state payload');
    expect(result.payload.clusterSeries.map((series) => series.category)).toEqual([
      'pending',
      'active',
      'done',
    ]);
    expect(result.payload.pools[0].workers[0].worker).toEqual(makeWorkerRef('attn', '0'));
    expect(result.payload.pools[0].workers[0].series.map((series) => series.category)).toEqual([
      'pending',
      'active',
      'done',
    ]);
  });

  it('rejects broken bin and category lengths', () => {
    const input = payload();
    input.t_end_ms = [5, 11];
    input.cluster_series = [{ category: 'pending', values: [1] }];

    expect(decodeAnalyzerV1RequestStatePayload(input)).toMatchObject({
      status: 'incompatible',
      reason: expect.stringMatching(/cluster_series\.0\.values/),
    });
  });

  it('keeps analyzer unavailable distinct from incompatible', () => {
    expect(
      decodeAnalyzerV1RequestStatePayload({
        schema_version: 1,
        meta: { log_dir: 'logs/request-state', available: false, reason: 'stage logging off' },
        t_start_ms: [],
        t_end_ms: [],
        cluster_series: [],
        pools: [],
      }),
    ).toEqual({ subject: 'requestState', status: 'unavailable', reason: 'stage logging off' });
  });
});
