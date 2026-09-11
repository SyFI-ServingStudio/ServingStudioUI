/**
 * What the batch-composition parser refuses, and why each refusal is worth
 * having.
 *
 * The report is three distributions over one set of rows, published twice — once
 * per pool and once per worker — and almost every mistake it can contain is a
 * *consistent-looking* one: a percentile out of order, a pool whose workers do
 * not add up, a mean below what its own components require. None of those look
 * wrong on a chart. They look like findings.
 *
 * So the fixture below is a run that is right in every respect, and each test
 * breaks exactly one thing about it.
 */
import { describe, expect, it } from 'vitest';

import batchSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/batch_scatter.json';

import {
  BATCH_COMPOSITION_SCHEMA_VERSION,
  IncompatibleBatchCompositionError,
  parseBatchComposition,
  parseBatchSeries,
  UnavailableBatchCompositionError,
} from './batchComposition';

describe('parseBatchSeries', () => {
  it('preserves the real pool scatter, averages, labels, and definitions', () => {
    const value = parseBatchSeries(batchSeriesJson);
    expect(value).toMatchObject({
      sourceLogDir: batchSeriesJson.meta.log_dir,
      invocations: batchSeriesJson.meta.num_calls,
      workers: [],
    });
    expect(value.pools[0]).toMatchObject({
      poolTag: batchSeriesJson.pools[0].pool,
      plottedPoints: batchSeriesJson.pools[0].plotted_points,
      averages: batchSeriesJson.pools[0].avg,
      series: batchSeriesJson.pools[0].series,
    });
    expect(value.definitions).toEqual(batchSeriesJson.definitions);
  });

  it('keeps additive workers with the same id in different pools distinct', () => {
    const body = structuredClone(batchSeriesJson) as typeof batchSeriesJson & {
      workers: Array<
        (typeof batchSeriesJson.pools)[number] & { pool_tag: string; worker_id: number }
      >;
    };
    body.workers = body.pools.map((pool) => ({ ...pool, pool_tag: pool.pool, worker_id: 0 }));

    expect(
      parseBatchSeries(body).workers.map(({ poolTag, workerId }) => [poolTag, workerId]),
    ).toEqual(body.pools.map((pool) => [pool.pool, '0']));
  });

  it('refuses a scatter whose values no longer align with its timestamps', () => {
    const body = structuredClone(batchSeriesJson);
    body.pools[0].series[0].values.pop();
    expect(() => parseBatchSeries(body)).toThrow(/values: has .* points, expected/);
  });

  it('keeps a minimal schema-v1 payload without averages, definitions, or workers readable', () => {
    const body = structuredClone(batchSeriesJson) as Record<string, unknown> & {
      pools: Array<Record<string, unknown>>;
    };
    body.pools.forEach((pool) => Reflect.deleteProperty(pool, 'avg'));
    Reflect.deleteProperty(body, 'definitions');
    Reflect.deleteProperty(body, 'workers');

    expect(parseBatchSeries(body)).toMatchObject({ workers: [], definitions: {} });
    expect(
      parseBatchSeries(body).pools.every((pool) => Object.keys(pool.averages).length === 0),
    ).toBe(true);
  });
});

interface Metric {
  n: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
}

interface Metrics {
  batch_tokens: Metric;
  prefill_tokens: Metric;
  decode_request_count: Metric;
}

function metric(
  n: number,
  mean: number,
  p50: number,
  p90: number,
  p99: number,
  max: number,
): Metric {
  return { n, mean, p50, p90, p99, max };
}

/** A sample of nothing, as the producer's `stats()` writes it. */
const NOTHING: Metric = { n: 0, mean: null, p50: null, p90: null, p99: null, max: null };

/**
 * Prefill: a few hundred invocations each carrying most of a thousand tokens,
 * with a couple of decodes riding along. `batch = prefill + decode` exactly, as
 * an ordinary (non-speculative) engine writes it.
 */
function prefillMetrics(n: number): Metrics {
  return {
    batch_tokens: metric(n, 500, 480, 900, 1000, 1024),
    prefill_tokens: metric(n, 498, 478, 898, 998, 1024),
    decode_request_count: metric(n, 2, 2, 3, 4, 5),
  };
}

/** Decode: the skewed one — median 1, mean 7, max 64. */
function decodeMetrics(n: number): Metrics {
  return {
    batch_tokens: metric(n, 7, 1, 16, 40, 64),
    prefill_tokens: metric(n, 0, 0, 0, 0, 0),
    decode_request_count: metric(n, 7, 1, 16, 40, 64),
  };
}

function report() {
  return {
    schema_version: BATCH_COMPOSITION_SCHEMA_VERSION,
    available: true,
    meta: { num_calls: 1000 },
    pools: [
      { pool: 'prefill', num_calls: 400, metrics: prefillMetrics(100) },
      { pool: 'decode', num_calls: 600, metrics: decodeMetrics(150) },
    ],
    workers: [
      { pool_tag: 'prefill', worker_id: 0, num_calls: 200, metrics: prefillMetrics(50) },
      { pool_tag: 'prefill', worker_id: 1, num_calls: 200, metrics: prefillMetrics(50) },
      { pool_tag: 'decode', worker_id: 0, num_calls: 300, metrics: decodeMetrics(75) },
      { pool_tag: 'decode', worker_id: 1, num_calls: 300, metrics: decodeMetrics(75) },
    ],
    definitions: { batch_tokens: 'tokens in the batch this invocation ran' },
  };
}

/** The issues raised, or a failure if the body was accepted. */
function refused(body: unknown): readonly string[] {
  try {
    parseBatchComposition(body);
  } catch (error) {
    if (error instanceof IncompatibleBatchCompositionError) return error.issues;
    throw error;
  }
  throw new Error('the parser accepted a body this test expected it to refuse');
}

describe('parseBatchComposition', () => {
  it('reads a run whose pools and workers agree', () => {
    const value = parseBatchComposition(report());

    expect(value.invocations).toBe(1000);
    expect(value.pools.map((pool) => pool.poolTag)).toEqual(['prefill', 'decode']);
    // In wire order, not sorted: what order the rows are read in is the panel's
    // decision, and a parser that sorted would take it away.
    expect(value.workers.map((worker) => `${worker.poolTag}/${worker.workerId}`)).toEqual([
      'prefill/0',
      'prefill/1',
      'decode/0',
      'decode/1',
    ]);
    const decode = value.pools[1];
    expect(decode.invocations).toBe(600);
    expect(decode.sampled).toBe(150);
    expect(decode.batchTokens).toEqual({
      samples: 150,
      mean: 7,
      p50: 1,
      p90: 16,
      p99: 40,
      max: 64,
    });
    expect(value.definitions.batch_tokens).toContain('tokens in the batch');
  });

  it('says an ordinary engine ran no speculative draft rows', () => {
    // Not `null`, which would mean "unmeasured", and not omitted: zero is the
    // measurement. `batch = prefill + decode_requests` exactly is what a
    // non-speculative engine looks like, and the panel says so.
    const value = parseBatchComposition(report());
    expect(value.pools.map((pool) => pool.draftRows)).toEqual([0, 0]);
  });

  it('reads the excess over the request count as speculative draft rows', () => {
    // A run whose batches average 3 rows more than its requests: those rows are
    // real work the GPU did, and the request count alone cannot see them. See
    // the parser header — `decode_query_rows` exceeds `decode_request_count` by
    // the draft rows, and only the request count is published.
    const body = report();
    body.pools[1].metrics.batch_tokens = metric(150, 10, 4, 19, 43, 67);
    for (const worker of body.workers.slice(2)) {
      worker.metrics.batch_tokens = metric(75, 10, 4, 19, 43, 67);
    }
    const value = parseBatchComposition(body);
    expect(value.pools[1].draftRows).toBeCloseTo(3, 12);
  });

  it('refuses a batch mean below what its own components require', () => {
    // The one relation that ties the three distributions together. Below it the
    // report is describing batches smaller than the tokens it says were in
    // them, and every "what was this made of" sentence built on it is arithmetic
    // on unrelated numbers.
    const body = report();
    body.pools[0].metrics.batch_tokens = metric(100, 400, 480, 900, 1000, 1024);
    expect(refused(body).join('\n')).toContain('below the 500');
  });

  it('accepts a batch mean above its components, which is what speculation looks like', () => {
    const body = report();
    body.pools[0].metrics.prefill_tokens = metric(100, 100, 478, 898, 998, 1024);
    expect(parseBatchComposition(body).pools[0].draftRows).toBeCloseTo(398, 9);
  });

  it('refuses a largest batch smaller than the largest prefill inside it', () => {
    const body = report();
    body.pools[0].metrics.batch_tokens = metric(100, 500, 480, 600, 700, 900);
    expect(refused(body).join('\n')).toContain('the largest batch held 900 tokens');
  });

  it('does not turn floating-point residue into speculation', () => {
    // An ordinary engine whose three means do not subtract exactly: 0.3 minus
    // 0.1 minus 0.2 is -2.8e-17 in binary floating point. The report is
    // correct — the identity holds to well inside the tolerance — and the
    // residue is arithmetic, not a negative count of rows the GPU processed.
    const body = report();
    const tiny = (mean: number) => metric(150, mean, mean, mean, mean, mean);
    body.pools[1].metrics = {
      batch_tokens: tiny(0.3),
      prefill_tokens: tiny(0.1),
      decode_request_count: tiny(0.2),
    };
    const half = {
      batch_tokens: metric(75, 0.3, 0.3, 0.3, 0.3, 0.3),
      prefill_tokens: metric(75, 0.1, 0.1, 0.1, 0.1, 0.1),
      decode_request_count: metric(75, 0.2, 0.2, 0.2, 0.2, 0.2),
    };
    body.workers[2].metrics = half;
    body.workers[3].metrics = half;

    expect(0.3 - 0.1 - 0.2).toBeLessThan(0);
    expect(parseBatchComposition(body).pools[1].draftRows).toBe(0);
  });

  it('refuses percentiles that do not ascend, at every step of the ladder', () => {
    // Each neighbouring pair, not just the first. They come off one sorted
    // array at the source, so any inversion is a report that is not describing
    // a distribution — and a check that only looked at p50 against p90 would
    // pass a p99 below its own p90.
    for (const [broken, message] of [
      [{ p90: 400 }, 'p90 400 is below p50 480'],
      [{ p99: 470 }, 'p99 470 is below p90 900'],
      [{ max: 900 }, 'max 900 is below p99 1000'],
    ] as const) {
      const body = report();
      body.pools[0].metrics.batch_tokens = { ...body.pools[0].metrics.batch_tokens, ...broken };
      expect(refused(body).join('\n')).toContain(message);
    }
  });

  it('refuses a largest batch below the largest decode count as well as the largest prefill', () => {
    // Row-wise the batch holds both, so it is at least either. Checking only
    // the prefill leaves the decode column free to exceed the batch that
    // carried it.
    const body = report();
    body.pools[1].metrics.decode_request_count = {
      ...body.pools[1].metrics.decode_request_count,
      max: 4000,
      p99: 40,
    };
    expect(refused(body).join('\n')).toContain('below the 4000 of its own decode_request_count');
  });

  it('checks a worker’s distributions as closely as a pool’s', () => {
    // The report publishes the same rows twice, once per pool and once per
    // worker, and a reader descends into the second. Validating only the first
    // leaves every figure the drill-down shows unchecked.
    const body = report();
    body.workers[0].metrics.batch_tokens = {
      ...body.workers[0].metrics.batch_tokens,
      p90: 1,
    };
    expect(refused(body).join('\n')).toContain(
      'workers.prefill/0.batch_tokens: p90 1 is below p50',
    );
  });

  it('refuses percentiles that do not ascend', () => {
    // They come off one sorted array at the source. A p90 below the p50 is not a
    // distribution with an unusual shape; it is not a distribution.
    const body = report();
    body.pools[1].metrics.batch_tokens = metric(150, 7, 20, 16, 40, 64);
    expect(refused(body).join('\n')).toContain('p90 16 is below p50 20');
  });

  it('refuses a mean above the largest sample', () => {
    const body = report();
    body.pools[1].metrics.batch_tokens = metric(150, 100, 1, 16, 40, 64);
    expect(refused(body).join('\n')).toContain('mean 100 is above the largest sample 64');
  });

  it('refuses a distribution that is half missing', () => {
    // One `stats()` call answers all five or none of them. A maximum with no
    // median means something reassembled the object, and the panel would render
    // the hole as a zero.
    const body = report();
    body.pools[1].metrics.batch_tokens = { ...decodeMetrics(150).batch_tokens, p50: null };
    expect(refused(body).join('\n')).toContain('some of the distribution is missing');
  });

  it('refuses samples with no distribution', () => {
    const body = report();
    body.pools[1].metrics.batch_tokens = { ...NOTHING, n: 150 };
    expect(refused(body).join('\n')).toContain('150 samples with no distribution');
  });

  it('refuses a distribution over no samples', () => {
    const body = report();
    body.pools[1].metrics.batch_tokens = metric(0, 7, 1, 16, 40, 64);
    expect(refused(body).join('\n')).toContain('a distribution over no samples');
  });

  it('refuses more samples than there were invocations', () => {
    // The distribution is over a regular stride through the iterations, so it is
    // a subset. More samples than rows means the two counts are not about the
    // same run, and the panel prints them in one sentence.
    const body = report();
    body.pools[1].num_calls = 100;
    body.meta.num_calls = 500;
    body.workers[2].num_calls = 50;
    body.workers[3].num_calls = 50;
    expect(refused(body).join('\n')).toContain('150 sampled out of 100 invocations');
  });

  it('refuses three metrics that cover different numbers of invocations', () => {
    // They are three columns of one pass over one set of rows, all non-nullable
    // at the source. Differing counts mean the comparisons below — which is the
    // whole subject — are between different populations.
    const body = report();
    body.pools[1].metrics.prefill_tokens = metric(140, 0, 0, 0, 0, 0);
    expect(refused(body).join('\n')).toContain('are not the same ones');
  });

  it('accepts a scope that sampled nothing at all', () => {
    // Legitimate: a pool with fewer invocations than the stride is stepped over
    // entirely. The count stays exact and the distribution is absent, which is a
    // different thing from zero.
    const body = report();
    body.pools[1].metrics = {
      batch_tokens: { ...NOTHING },
      prefill_tokens: { ...NOTHING },
      decode_request_count: { ...NOTHING },
    };
    for (const worker of body.workers.slice(2)) {
      worker.metrics = {
        batch_tokens: { ...NOTHING },
        prefill_tokens: { ...NOTHING },
        decode_request_count: { ...NOTHING },
      };
    }
    const value = parseBatchComposition(body);
    expect(value.pools[1].sampled).toBe(0);
    expect(value.pools[1].batchTokens).toBeNull();
    // Unmeasured, not zero: there is no sample to have measured a count of
    // draft rows over.
    expect(value.pools[1].draftRows).toBeNull();
  });

  it('refuses pools that hold more invocations than the run ran', () => {
    // One direction only. The caption counts every invocation in the cost log;
    // the pool list is built from the *sampled* rows, so it can hold fewer. It
    // can never hold more — those would be invocations from outside the log the
    // caption counted.
    const body = report();
    body.meta.num_calls = 900;
    expect(refused(body).join('\n')).toContain('900 invocations declared, but the pools hold 1000');
  });

  it('accepts a pool the sampling stride stepped over, and keeps both counts', () => {
    // The producer counts invocations for every pool that ran and publishes a
    // row only for the pools its stride landed on, so a pool that ran on
    // iterations the stride skipped is in the caption and not in the list. That
    // is a document the Analyzer emits — refusing it would blank the panel on a
    // healthy run — and the schema keeps both numbers so the projection can
    // state the difference a reader adding the rows up will not reach.
    const body = report();
    body.meta.num_calls = 1200;
    const value = parseBatchComposition(body);
    expect(value.invocations).toBe(1200);
    // And nothing invented for the pool nobody measured.
    expect(value.pools.map((pool) => pool.poolTag)).toEqual(['prefill', 'decode']);
    expect(value.pools.reduce((total, pool) => total + pool.invocations, 0)).toBe(1000);
  });

  it('reads a pool that logs no composition as one that has none, not as an empty batch', () => {
    // The FFN logger writes the batch size and zeros the two attention-shaped
    // columns it never read. Taken at face value that is a 64-token batch made
    // of no prefill and no decode requests, and the whole 64 falls out of the
    // subtraction as speculation — on an ordinary run, in a pool that cannot
    // speculate. Impossible where the fields are populated: a positive batch is
    // their sum there, so one of them has to be positive too.
    const body = report();
    body.pools[1].metrics = {
      batch_tokens: metric(150, 64, 64, 64, 64, 64),
      prefill_tokens: metric(150, 0, 0, 0, 0, 0),
      decode_request_count: metric(150, 0, 0, 0, 0, 0),
    };
    const half = { ...body.pools[1].metrics };
    half.batch_tokens = metric(75, 64, 64, 64, 64, 64);
    half.prefill_tokens = metric(75, 0, 0, 0, 0, 0);
    half.decode_request_count = metric(75, 0, 0, 0, 0, 0);
    body.workers[2].metrics = half;
    body.workers[3].metrics = half;

    const pool = parseBatchComposition(body).pools[1];
    // The batch size survives — that one the pool did log.
    expect(pool.batchTokens?.mean).toBe(64);
    expect(pool.prefillTokens).toBeNull();
    expect(pool.decodeRequests).toBeNull();
    // And nothing is inferred from the difference between a measurement and two
    // fields that were never written.
    expect(pool.draftRows).toBeNull();
  });

  it('claims no composition for a sample whose batches were all empty', () => {
    // Every figure zero, which is what an FFN pool writes for a sample of empty
    // batches and equally what an attention pool measures over one. Nothing in
    // the report separates the two, so the parser does not choose: it publishes
    // the batch distribution it was given and withholds a composition it cannot
    // vouch for. The zeros would have been right either way — the claim that
    // would not is a draft-row count of 0, "this engine ran no speculative
    // rows", inferred from two columns that may never have been written.
    const body = report();
    const empty = (n: number) => ({
      batch_tokens: metric(n, 0, 0, 0, 0, 0),
      prefill_tokens: metric(n, 0, 0, 0, 0, 0),
      decode_request_count: metric(n, 0, 0, 0, 0, 0),
    });
    body.pools[1].metrics = empty(150);
    body.workers[2].metrics = empty(75);
    body.workers[3].metrics = empty(75);

    const pool = parseBatchComposition(body).pools[1];
    // The batch distribution survives: 150 invocations were sampled and they
    // carried nothing, which is a measurement and a finding.
    expect(pool.sampled).toBe(150);
    expect(pool.batchTokens?.mean).toBe(0);
    expect(pool.prefillTokens).toBeNull();
    expect(pool.decodeRequests).toBeNull();
    expect(pool.draftRows).toBeNull();
  });

  it('keeps a measured zero composition, which is a batch of prefill alone', () => {
    // The discriminator is the *pair* being zero while the batch is not. A pool
    // whose batches are all prefill has a zero decode count and a positive
    // prefill one, and that is a measurement.
    const body = report();
    body.pools[1].metrics = {
      batch_tokens: metric(150, 64, 64, 64, 64, 64),
      prefill_tokens: metric(150, 64, 64, 64, 64, 64),
      decode_request_count: metric(150, 0, 0, 0, 0, 0),
    };
    const half = { ...body.pools[1].metrics };
    half.batch_tokens = metric(75, 64, 64, 64, 64, 64);
    half.prefill_tokens = metric(75, 64, 64, 64, 64, 64);
    half.decode_request_count = metric(75, 0, 0, 0, 0, 0);
    body.workers[2].metrics = half;
    body.workers[3].metrics = half;

    const pool = parseBatchComposition(body).pools[1];
    expect(pool.prefillTokens?.mean).toBe(64);
    expect(pool.decodeRequests?.mean).toBe(0);
    expect(pool.draftRows).toBe(0);
  });

  it('refuses a pool whose workers ran more invocations than the pool', () => {
    // The other direction is the stride again: a worker it stepped over is
    // absent from the list and counted in its pool's total. More than the pool
    // is a worker that ran outside it.
    const body = report();
    body.workers[1].num_calls = 500;
    expect(refused(body).join('\n')).toContain('ran 400 invocations, but its workers ran 700');
  });

  it('accepts a worker the sampling stride stepped over', () => {
    const body = report();
    body.workers[1].num_calls = 100;
    expect(parseBatchComposition(body).workers).toHaveLength(body.workers.length);
  });

  it('refuses a pool whose workers sampled a different number of invocations', () => {
    const body = report();
    body.workers[1].metrics = prefillMetrics(40);
    expect(refused(body).join('\n')).toContain(
      'sampled 100 invocations, but its workers sampled 90',
    );
  });

  it('accepts a pool with no workers published', () => {
    // The per-worker breakdown is optional in the report. The pool row still
    // stands on its own; only the drill-down below it is empty.
    const body = report();
    body.workers = body.workers.slice(0, 2);
    expect(parseBatchComposition(body).workers).toHaveLength(2);
  });

  it('refuses the same pool twice', () => {
    const body = report();
    body.pools[1] = { ...body.pools[1], pool: 'prefill' };
    expect(refused(body).join('\n')).toContain('appears more than once');
  });

  it('refuses the same worker twice', () => {
    const body = report();
    body.workers[1] = { ...body.workers[1], worker_id: 0 };
    expect(refused(body).join('\n')).toContain('prefill/0 appears more than once');
  });

  it('refuses a worker whose pool the report does not publish', () => {
    // The panel's pool rows are links, and a worker filed under a pool with no
    // row is a worker no address can reach.
    const body = report();
    body.workers[0] = { ...body.workers[0], pool_tag: 'ffn' };
    expect(refused(body).join('\n')).toContain('which pools does not publish');
  });

  it('refuses a pool name that cannot be put in an address', () => {
    // Every row of this panel is a link down to the pool. `..` survives
    // `encodeURIComponent` and is then resolved away by the URL parser, so the
    // link would fetch a different route.
    const body = report();
    body.pools[0] = { ...body.pools[0], pool: '..' };
    body.workers[0] = { ...body.workers[0], pool_tag: '..' };
    body.workers[1] = { ...body.workers[1], pool_tag: '..' };
    expect(refused(body).join('\n')).toContain('cannot be put in an address');
  });

  it('says the analysis has nothing rather than failing to read it', () => {
    expect(() =>
      parseBatchComposition({
        schema_version: BATCH_COMPOSITION_SCHEMA_VERSION,
        available: false,
        reason: 'cost_log/ dir not found',
      }),
    ).toThrow(UnavailableBatchCompositionError);
  });

  it('reports the version it was handed when the shape is one it cannot read', () => {
    const body = { ...report(), schema_version: 7 };
    try {
      parseBatchComposition(body);
      throw new Error('accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleBatchCompositionError);
      expect((error as IncompatibleBatchCompositionError).received).toBe(7);
    }
  });
});
