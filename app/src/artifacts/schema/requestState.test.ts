/**
 * The report states the same populations at three scopes, and every test here
 * is about one of them disagreeing with another.
 *
 * The emphasis is deliberate: a pool card that says eight requests were queued
 * over workers that add up to three renders exactly as well as a correct one.
 * Nothing downstream can tell, so the read is refused.
 */
import { describe, expect, it } from 'vitest';

import {
  IncompatibleRequestStateError,
  UnavailableRequestStateError,
  parseRequestState,
  parseRequestStateSeries,
} from './requestState';

function population(category: string, mean: number, peak: number): unknown {
  return { category, mean, peak };
}

const timeline = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/example',
    deployment: 'unified',
    requests_with_stage_history: 10,
    transitions: 20,
    span_ms: 10,
    num_bins: 2,
    bin_width_ms: 5,
    aggregation: 'equal-width time-weighted mean',
  },
  t_start_ms: [0, 5],
  t_end_ms: [5, 10],
  cluster_series: [{ category: 'pending', values: [3, 5] }],
  pools: [
    {
      pool: 0,
      pool_tag: 'attn',
      n_workers: 2,
      total_pending: [3, 5],
      average_pending: [1.5, 2.5],
      workers: [
        {
          worker_id: 0,
          pending: [1, 2],
          series: [{ category: 'pending', values: [1, 2] }],
        },
        {
          worker_id: 1,
          pending: [2, 3],
          series: [{ category: 'pending', values: [2, 3] }],
        },
      ],
    },
  ],
  definitions: { pending: 'all pending stages' },
};

describe('parseRequestStateSeries', () => {
  it('preserves every scope and the composite worker identity', () => {
    const value = parseRequestStateSeries(timeline);
    expect(value).toMatchObject({
      tStartMs: [0, 5],
      tEndMs: [5, 10],
      clusterSeries: [{ category: 'pending', values: [3, 5] }],
      sourceLogDir: 'logs/example',
      deployment: 'unified',
      requestsTracked: 10,
      transitions: 20,
      window: { spanMs: 10, bins: 2, binWidthMs: 5 },
      aggregation: 'equal-width time-weighted mean',
      definitions: { pending: 'all pending stages' },
    });
    expect(value.pools[0].workers.map((worker) => worker.worker)).toEqual([
      { poolTag: 'attn', workerId: '0' },
      { poolTag: 'attn', workerId: '1' },
    ]);
  });

  it('refuses a gap between adjacent bins', () => {
    expect(() => parseRequestStateSeries({ ...timeline, t_start_ms: [0, 6] })).toThrow(
      /must equal the previous bin end/,
    );
  });

  it('refuses pending data that disagrees with the pending category', () => {
    const body = structuredClone(timeline);
    body.pools[0].workers[0].pending[0] = 9;
    expect(() => parseRequestStateSeries(body)).toThrow(/must equal the pending category/);
  });

  it('refuses a pool total that disagrees with its workers', () => {
    const body = structuredClone(timeline);
    body.pools[0].total_pending[0] = 4;
    expect(() => parseRequestStateSeries(body)).toThrow(/does not match worker sum/);
  });

  it('refuses a pool average that disagrees with its roster', () => {
    const body = structuredClone(timeline);
    body.pools[0].average_pending[0] = 3;
    expect(() => parseRequestStateSeries(body)).toThrow(/does not match total \/ workers/);
  });

  it('refuses a worker that omits a cluster category', () => {
    const body = structuredClone(timeline);
    body.cluster_series.push({ category: 'active', values: [0, 0] });
    expect(() => parseRequestStateSeries(body)).toThrow(/missing category active/);
  });

  it('refuses a cluster category that disagrees with the workers', () => {
    const body = structuredClone(timeline);
    body.cluster_series[0].values[0] = 4;
    expect(() => parseRequestStateSeries(body)).toThrow(/does not match worker sum/);
  });

  it('keeps the old schema-v1 cluster-only payload readable', () => {
    const body = structuredClone(timeline);
    body.pools = [];
    body.meta = { log_dir: 'logs/example' } as typeof body.meta;
    Reflect.deleteProperty(body, 'definitions');

    expect(parseRequestStateSeries(body)).toMatchObject({
      pools: [],
      deployment: null,
      window: null,
      definitions: {},
    });
  });

  it('preserves the unavailable reason', () => {
    expect(() =>
      parseRequestStateSeries({
        schema_version: 1,
        meta: { log_dir: 'logs/example', available: false, reason: 'no stage history' },
        t_start_ms: [],
        t_end_ms: [],
        cluster_series: [],
        pools: [],
      }),
    ).toThrow(UnavailableRequestStateError);
  });
});

function pool(tag: string, workers: number, mean: number, peak: number): unknown {
  return {
    pool: 0,
    pool_tag: tag,
    n_workers: workers,
    mean_total_pending: mean,
    peak_total_pending: peak,
    mean_pending_per_worker: mean / workers,
  };
}

function worker(
  tag: string,
  id: number,
  mean: number,
  peak: number,
  extra: readonly unknown[] = [],
): unknown {
  return {
    pool: 0,
    pool_tag: tag,
    worker_id: id,
    mean_pending: mean,
    peak_pending: peak,
    categories: [population('pending', mean, peak), ...extra],
  };
}

function report(over: {
  cluster?: unknown[];
  pools?: unknown[];
  workers?: unknown[];
  meta?: Record<string, unknown>;
}): unknown {
  return {
    schema_version: 1,
    available: true,
    meta: {
      deployment: 'unified',
      requests_with_stage_history: 512,
      transitions: 2048,
      span_ms: 1000,
      num_bins: 200,
      bin_width_ms: 5,
      aggregation: 'equal-width time-weighted mean',
      ...over.meta,
    },
    totals: {
      cluster_categories: over.cluster ?? [population('pending', 3, 10)],
      pools: over.pools ?? [pool('main', 2, 3, 10)],
      workers: over.workers ?? [worker('main', 0, 1, 4), worker('main', 1, 2, 6)],
    },
    definitions: { pending: 'all pending:* stages' },
  };
}

function refusal(payload: unknown): string {
  try {
    parseRequestState(payload);
  } catch (error) {
    if (error instanceof IncompatibleRequestStateError) return error.issues.join('; ');
    throw error;
  }
  throw new Error('expected the report to be refused');
}

describe('parseRequestState', () => {
  it('reads a two-worker pool', () => {
    const state = parseRequestState(report({}));
    expect(state.cluster).toEqual([{ category: 'pending', meanRequests: 3, peakRequests: 10 }]);
    expect(state.pools).toEqual([
      {
        poolTag: 'main',
        workers: 2,
        meanTotalPending: 3,
        peakTotalPending: 10,
        meanPendingPerWorker: 1.5,
      },
    ]);
    // Every field of both workers, not just their ids. A worker's mean and its
    // peak are the same shape of number in the same object, and a projection
    // that read one for the other renders as a queue that never varied — which
    // is a finding, not a bug, as far as anything downstream can tell. The two
    // workers differ in both, so a read that mixed up the workers is caught as
    // well.
    expect(state.workers).toEqual([
      {
        poolTag: 'main',
        workerId: '0',
        meanPending: 1,
        peakPending: 4,
        categories: [{ category: 'pending', meanRequests: 1, peakRequests: 4 }],
      },
      {
        poolTag: 'main',
        workerId: '1',
        meanPending: 2,
        peakPending: 6,
        categories: [{ category: 'pending', meanRequests: 2, peakRequests: 6 }],
      },
    ]);
    expect(state.requestsTracked).toBe(512);
    expect(state.window).toEqual({ spanMs: 1000, bins: 200, binWidthMs: 5 });
  });

  it('says an unlogged run is unavailable rather than failed', () => {
    // The reader's next step is a simulator setting, not a retry, and the two
    // states put different words on the page.
    expect(() =>
      parseRequestState({
        schema_version: 1,
        available: false,
        reason: 'io.log_stage_transitions was not enabled',
      }),
    ).toThrow(UnavailableRequestStateError);
  });

  it('refuses a pool whose workers do not add up to it', () => {
    // The page would show a queue nobody is holding.
    //
    // Two pools, and the shortfall in one made up by the other, so that the
    // *cluster* still reconciles with the workers. With a single pool the same
    // payload also fails the cluster check — whose message carries the same
    // words — and the test passed with the pool check deleted, proving only
    // that something somewhere had noticed.
    const twoPools = {
      cluster: [population('pending', 3, 10)],
      pools: [pool('a', 2, 3, 10), { ...(pool('b', 2, 1, 5) as object), pool: 1 }],
      workers: [
        worker('a', 0, 1, 4),
        worker('a', 1, 1, 6),
        { ...(worker('b', 0, 1, 5) as object), pool: 1 },
        { ...(worker('b', 1, 0, 0) as object), pool: 1 },
      ],
    };
    // Named, and named as the pool it is about: `a` states 3 over workers
    // holding 2, while `b` states what its workers hold.
    expect(refusal(report(twoPools))).toContain(
      'pool "a" totals 3 pending, but its workers sum to 2',
    );
    expect(refusal(report(twoPools))).not.toContain('the run holds');
  });

  it('refuses a pool that averaged more than its own worst moment', () => {
    // One pass over one set of bin deltas produces both, so a mean above a peak
    // is not a pool. The two are printed side by side at this scope — "averaged
    // 9, worst moment 8" — where neither number gives the reader a reason to
    // doubt the other.
    expect(
      refusal(
        report({
          cluster: [population('pending', 9, 10)],
          pools: [pool('main', 2, 9, 8)],
          workers: [worker('main', 0, 5, 4), worker('main', 1, 4, 6)],
        }),
      ),
    ).toContain('totals.pools.main: mean 9 exceeds peak 8');
  });

  describe('conservation of the requests the run tracked', () => {
    // Each request is in exactly one category at a time: the producer removes
    // it from the stage it is leaving before adding the one it is entering. So
    // the categories cannot hold more requests than the run has.
    it('refuses a category peak above the tracked population', () => {
      expect(
        refusal(
          report({
            meta: { requests_with_stage_history: 4 },
            cluster: [population('pending', 3, 10)],
          }),
        ),
      ).toContain('peaks at 10 requests, above the 4 the run tracked');
    });

    it('refuses categories that together average more than the run tracked', () => {
      // Neither category is impossible on its own — 3 and 2 are both under 4 —
      // and a request cannot be in both at once.
      expect(
        refusal(
          report({
            meta: { requests_with_stage_history: 4 },
            cluster: [population('pending', 3, 10), population('done', 2, 4)],
            pools: [pool('main', 2, 3, 10)],
            workers: [
              worker('main', 0, 1, 4, [population('done', 1, 2)]),
              worker('main', 1, 2, 6, [population('done', 1, 2)]),
            ],
          }),
        ),
      ).toContain('average 5 requests together, above the 4 the run tracked');
    });
  });

  it('refuses a reconciliation that only holds because the numbers are tiny', () => {
    // A request spending a microsecond in a stage of a long run averages a few
    // billionths of a request, so these values are legitimate. What is not is
    // calling 1.1e-9 and 2e-9 equal: with an absolute floor of 1e-9 they were,
    // and the panel divided one by the other and drew a pool holding 182% of
    // the run's queue.
    expect(
      refusal(
        report({
          cluster: [population('pending', 1.1e-9, 1)],
          pools: [pool('main', 1, 2e-9, 1)],
          workers: [worker('main', 0, 2e-9, 1)],
        }),
      ),
    ).toContain('but its workers sum to 2e-9');
  });

  it('refuses a per-worker average that is not the total over the roster', () => {
    // Two independently computed numbers, one identity between them. A card
    // that showed both would be quietly self-contradictory.
    const wrong = {
      ...(pool('main', 2, 3, 10) as Record<string, unknown>),
      mean_pending_per_worker: 3,
    };
    expect(refusal(report({ pools: [wrong] }))).toContain('is not the stated total');
  });

  it('refuses a pool with fewer workers listed than it declares', () => {
    // The Analyzer walks the whole roster, so a short list means a worker went
    // missing between the two — and the map beside this panel would still draw
    // it.
    expect(refusal(report({ workers: [worker('main', 0, 3, 10)] }))).toContain(
      'declares 2 workers, but 1 are listed',
    );
  });

  it('refuses a pool peak below its busiest worker', () => {
    // The pool held at least what its worst worker held at that moment.
    expect(refusal(report({ pools: [pool('main', 2, 3, 5)] }))).toContain(
      'below its busiest worker',
    );
  });

  it('refuses a pool peak above what its workers could contribute at once', () => {
    expect(refusal(report({ pools: [pool('main', 2, 3, 11)] }))).toContain(
      'above the 10 its workers could contribute',
    );
  });

  it('accepts a pool peak between the two, because peaks do not add', () => {
    // 6 is the busiest worker and 10 is the sum: the pool's own sweep may land
    // anywhere between, and refusing that would reject every real report where
    // two workers were not busy at the same instant.
    //
    // The run peak moves with it. This deployment has one pool, so the bracket
    // the run is held to collapses to equality — there is nowhere else for a
    // queued request to be.
    expect(
      parseRequestState(
        report({ cluster: [population('pending', 3, 7)], pools: [pool('main', 2, 3, 7)] }),
      ).pools[0],
    ).toMatchObject({ peakTotalPending: 7 });
  });

  it('refuses a run whose category does not add up over its workers', () => {
    expect(
      refusal(
        report({
          cluster: [population('pending', 3, 10), population('active', 9, 12)],
          workers: [
            worker('main', 0, 1, 4, [population('active', 2, 6)]),
            worker('main', 1, 2, 6, [population('active', 2, 6)]),
          ],
        }),
      ),
    ).toContain('holds 9 requests in "active", but its workers sum to 4');
  });

  it('refuses a worker whose categories are not the run’s', () => {
    // The panel puts the worker's breakdown beside the run's. A worker missing
    // a category would be compared against a different denominator.
    expect(
      refusal(
        report({
          cluster: [population('pending', 3, 10), population('active', 4, 6)],
          workers: [worker('main', 0, 1, 4, [population('active', 2, 3)]), worker('main', 1, 2, 6)],
        }),
      ),
    ).toContain("are not the run's");
  });

  it('refuses a worker whose queue is not its own pending population', () => {
    // The Analyzer bins the same events twice and publishes them under two
    // names. Two names for one number is two chances to contradict itself.
    const wrong = {
      ...(worker('main', 1, 2, 6) as Record<string, unknown>),
      categories: [population('pending', 1, 6)],
    };
    expect(
      refusal(
        report({
          cluster: [population('pending', 2, 10)],
          workers: [worker('main', 0, 1, 4), wrong],
        }),
      ),
    ).toContain('is not its "pending" population');
  });

  it('refuses a report whose bins do not span its window', () => {
    expect(refusal(report({ meta: { bin_width_ms: 4 } }))).toContain('do not span');
  });

  it('refuses a pool listed twice', () => {
    expect(refusal(report({ pools: [pool('main', 2, 3, 10), pool('main', 2, 3, 10)] }))).toContain(
      'appears more than once',
    );
  });

  it('refuses a worker of a pool the report does not publish', () => {
    expect(
      refusal(report({ workers: [worker('main', 0, 1, 4), worker('other', 1, 2, 6)] })),
    ).toContain('which totals.pools does not publish');
  });

  it('refuses a pool tag that could not be put in an address', () => {
    const long = 'p'.repeat(200);
    expect(
      refusal(
        report({
          pools: [pool(long, 2, 3, 10)],
          workers: [worker(long, 0, 1, 4), worker(long, 1, 2, 6)],
        }),
      ),
    ).toContain('cannot be put in an address');
  });

  it('refuses a pool tag that would rewrite the read’s own URL', () => {
    expect(
      refusal(
        report({
          pools: [pool('..', 2, 3, 10)],
          workers: [worker('..', 0, 1, 4), worker('..', 1, 2, 6)],
        }),
      ),
    ).toContain('cannot be put in an address');
  });

  it('refuses a mean above its own peak', () => {
    expect(refusal(report({ cluster: [population('pending', 11, 10)] }))).toContain(
      'exceeds peak 10',
    );
  });

  it('refuses a run peak below the worst worker it is made of', () => {
    // The run panel divides pool peaks by this one. A cluster peak of 5 over
    // workers that peaked at 4 and 6 renders as a pool holding 200% of the
    // run's worst moment, and nothing else on the page contradicts it. The peak
    // is still above this scope's own mean, so the plain mean-versus-peak check
    // has nothing to say about it — only the comparison with the workers does.
    expect(refusal(report({ cluster: [population('pending', 3, 5)] }))).toContain(
      "below its busiest worker's 6",
    );
  });

  it('refuses a run peak above what its workers could hold at once', () => {
    // The peak of a sum is not the sum of the peaks, but it cannot exceed it:
    // 4 and 6 cannot produce 11 however they line up in time.
    expect(refusal(report({ cluster: [population('pending', 3, 11)] }))).toContain(
      'above the 10 its workers could hold at once',
    );
  });

  it('refuses a worker population whose mean is above its own peak', () => {
    // The queue is checked first because the panel ranks by it, and that check
    // is what this one is not: a worker that averaged six active requests while
    // never holding more than five still sums correctly into its pool and still
    // brackets correctly against the run. Every cross-scope reconciliation
    // passes, and the document is describing two different workers.
    expect(
      refusal(
        report({
          cluster: [population('pending', 3, 10), population('active', 7, 10)],
          workers: [
            worker('main', 0, 1, 4, [population('active', 6, 5)]),
            worker('main', 1, 2, 6, [population('active', 1, 5)]),
          ],
        }),
      ),
    ).toContain('"active" averages 6, above its own peak 5');
  });

  it('refuses a run peak below the busiest pool it is made of', () => {
    // Its workers peaked at 4 and 6, so 8 is comfortably inside the bracket they
    // impose — and the pool they belong to peaked at 10. The run panel divides
    // that pool peak by this number, so what the worker bracket lets through
    // renders as a pool holding 125% of the run's worst moment.
    expect(refusal(report({ cluster: [population('pending', 3, 8)] }))).toContain(
      "below its busiest pool's 10",
    );
  });

  it('refuses a run peak above what its pools could hold at once', () => {
    // Two pools of 5 over four workers of 3 and 4: the workers allow anything up
    // to 14, and the pools allow 10.
    const pools = [pool('a', 2, 3, 5), { ...(pool('b', 2, 3, 5) as object), pool: 1 }];
    const workers = [
      worker('a', 0, 1, 3),
      worker('a', 1, 2, 4),
      worker('b', 0, 1, 3),
      worker('b', 1, 2, 4),
    ];
    expect(refusal(report({ cluster: [population('pending', 6, 12)], pools, workers }))).toContain(
      'above the 10 its pools could hold at once',
    );
  });

  it('refuses a category named twice', () => {
    // The run's vocabulary is a set — the Analyzer keeps the first spelling of
    // each and drops the rest — and a repeat is read once by every check here
    // and added twice by the pool projection: a pool showing double the
    // requests its workers hold, under two rows with the same name.
    const twice = [
      population('pending', 3, 10),
      population('active', 2, 2),
      population('active', 2, 2),
    ];
    expect(
      refusal(
        report({
          cluster: twice,
          workers: [
            worker('main', 0, 1, 4, [population('active', 1, 1), population('active', 1, 1)]),
            worker('main', 1, 2, 6, [population('active', 1, 1), population('active', 1, 1)]),
          ],
        }),
      ),
    ).toContain('"active" appears more than once');
  });

  it('reports a schema version it does not read', () => {
    try {
      parseRequestState({ ...(report({}) as Record<string, unknown>), schema_version: 2 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleRequestStateError);
      expect((error as IncompatibleRequestStateError).received).toBe(2);
    }
  });
});
