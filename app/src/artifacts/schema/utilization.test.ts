/**
 * The parser's job is to refuse a report whose three scopes disagree, and to
 * pass through the one impossible value the Analyzer publishes on purpose.
 *
 * The numbers below are a two-pool run: `prefill` has one worker at 0.5,
 * `decode` has two at 0.9 and 0.3. So decode averages 0.6 over two workers, and
 * the run averages (0.5 + 0.9 + 0.3) / 3 = 0.5666… — capacity-weighted, not the
 * mean of 0.5 and 0.6.
 */
import { describe, expect, it } from 'vitest';

import utilizationJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/utilization_series.json';

import {
  IncompatibleUtilizationError,
  UnavailableUtilizationError,
  parseUtilization,
  parseUtilizationSeries,
} from './utilization';

const OVERALL = (0.5 + 0.9 + 0.3) / 3;

function report(over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    available: true,
    meta: {
      gpu_name: 'NVIDIA H200',
      log_dir: 'logs/x',
      num_pools: 2,
      num_workers: 3,
      span_ms: 60_000,
      num_bins: 200,
      bin_width_ms: 300,
    },
    totals: {
      overall_avg: OVERALL,
      per_pool: [
        { pool: 0, pool_tag: 'prefill', n_workers: 1, avg_util: 0.5 },
        { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: 0.6 },
      ],
      per_worker: [
        { pool: 0, pool_tag: 'prefill', worker_id: 0, avg_util: 0.5 },
        { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.9 },
        { pool: 1, pool_tag: 'decode', worker_id: 1, avg_util: 0.3 },
      ],
    },
    definitions: { metric: 'fraction of each worker busy computing' },
    ...over,
  };
}

function totals(over: Record<string, unknown>) {
  return report({ totals: { ...report().totals, ...over } });
}

function issues(body: unknown): string {
  try {
    parseUtilization(body);
  } catch (error) {
    if (error instanceof IncompatibleUtilizationError) return error.issues.join('\n');
    throw error;
  }
  throw new Error('expected the report to be refused');
}

describe('parseUtilization', () => {
  it('reads a run at all three scopes', () => {
    const value = parseUtilization(report());
    expect(value.overall).toBeCloseTo(OVERALL, 12);
    expect(value.pools).toEqual([
      { poolTag: 'prefill', workers: 1, busyFraction: 0.5 },
      { poolTag: 'decode', workers: 2, busyFraction: 0.6 },
    ]);
    // Worker ids become path segments, so they arrive as strings: the address
    // is where they are going, and a number would be turned into one anyway.
    expect(value.workers.map((worker) => worker.workerId)).toEqual(['0', '0', '1']);
    expect(value.gpu).toBe('NVIDIA H200');
    expect(value.window).toEqual({ spanMs: 60_000, bins: 200, binWidthMs: 300 });
  });

  it('has no GPU rather than one called ""', () => {
    // `read_run_meta` falls back to an empty name, and "" on screen beside the
    // word GPU reads as a model whose name did not render.
    const value = parseUtilization(report({ meta: { ...report().meta, gpu_name: '' } }));
    expect(value.gpu).toBeUndefined();
  });

  it('says a run logged no iterations rather than reporting it as a failure', () => {
    // Its own class, because the reader's next step is a simulator setting.
    expect(() =>
      parseUtilization({
        schema_version: 1,
        available: false,
        reason: 'cost_log/ dir not found',
      }),
    ).toThrow(UnavailableUtilizationError);
  });

  it('keeps a fraction above 1 instead of refusing or clamping it', () => {
    // The Analyzer publishes it on purpose: a worker busy 120% of the wall
    // clock has overlapping iteration intervals, and that is the symptom. A
    // parser that refused the document would delete the evidence; one that
    // clamped would draw a plausible, wrong plot.
    const value = parseUtilization(
      totals({
        overall_avg: (1.2 + 0.9 + 0.3) / 3,
        per_pool: [
          { pool: 0, pool_tag: 'prefill', n_workers: 1, avg_util: 1.2 },
          { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: 0.6 },
        ],
        per_worker: [
          { pool: 0, pool_tag: 'prefill', worker_id: 0, avg_util: 1.2 },
          { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.9 },
          { pool: 1, pool_tag: 'decode', worker_id: 1, avg_util: 0.3 },
        ],
      }),
    );
    expect(value.pools[0].busyFraction).toBeCloseTo(1.2, 12);
  });

  it('refuses a pool its workers do not add up to', () => {
    // Fractions do not add; busy time does. Decode's two workers sum to 1.2,
    // which is 0.6 across a roster of two — a pool that claimed 0.8 would be
    // drawn above workers that cannot produce it.
    expect(
      issues(
        totals({
          per_pool: [
            { pool: 0, pool_tag: 'prefill', n_workers: 1, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: 0.8 },
          ],
        }),
      ),
    ).toContain('workers sum to');
  });

  it('refuses a run that is not the capacity-weighted mean of its pools', () => {
    // The plain mean of 0.5 and 0.6 is 0.55, and it is wrong: decode has two
    // workers and prefill one. Both numbers are plausible percentages, which is
    // exactly why this has to be checked rather than trusted.
    expect(issues(totals({ overall_avg: 0.55 }))).toContain('its pools weigh');
  });

  it('refuses a pool that lists fewer workers than it divides by', () => {
    expect(
      issues(
        totals({
          per_worker: [
            { pool: 0, pool_tag: 'prefill', worker_id: 0, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 1.2 },
          ],
        }),
      ),
    ).toContain('declares 2 workers, but 1 are listed');
  });

  it('refuses a worker whose pool the report does not publish', () => {
    expect(
      issues(
        totals({
          per_worker: [
            { pool: 0, pool_tag: 'prefill', worker_id: 0, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.9 },
            { pool: 2, pool_tag: 'ghost', worker_id: 1, avg_util: 0.3 },
          ],
        }),
      ),
    ).toContain('which totals.per_pool does not publish');
  });

  it('refuses a pool listed twice', () => {
    expect(
      issues(
        totals({
          per_pool: [
            { pool: 0, pool_tag: 'decode', n_workers: 1, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: 0.6 },
          ],
        }),
      ),
    ).toContain('appears more than once');
  });

  it('refuses a worker listed twice in one pool', () => {
    expect(
      issues(
        totals({
          per_worker: [
            { pool: 0, pool_tag: 'prefill', worker_id: 0, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.9 },
            { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.3 },
          ],
        }),
      ),
    ).toContain('lists worker 0 more than once');
  });

  it('refuses a pool tag that cannot be put in an address', () => {
    // `..` is the one that matters: it is unreserved, so escaping returns it
    // unchanged and the URL parser resolves it away into a different route.
    expect(
      issues(
        totals({
          per_pool: [
            { pool: 0, pool_tag: '..', n_workers: 1, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: 0.6 },
          ],
          per_worker: [
            { pool: 0, pool_tag: '..', worker_id: 0, avg_util: 0.5 },
            { pool: 1, pool_tag: 'decode', worker_id: 0, avg_util: 0.9 },
            { pool: 1, pool_tag: 'decode', worker_id: 1, avg_util: 0.3 },
          ],
        }),
      ),
    ).toContain('cannot be put in an address');
  });

  it('refuses a count in meta that the lists do not match', () => {
    // `meta` is what the caption says and the lists are what the rows are drawn
    // from; a run that claims 33 workers and lists 8 renders either way.
    expect(issues(report({ meta: { ...report().meta, num_workers: 33 } }))).toContain(
      '33 workers declared, 3 listed',
    );
  });

  it('refuses a window whose bins do not span the run', () => {
    expect(issues(report({ meta: { ...report().meta, bin_width_ms: 42 } }))).toContain(
      'do not span',
    );
  });

  it('names the version it got when the body is a different schema', () => {
    try {
      parseUtilization(report({ schema_version: 7 }));
      throw new Error('expected the report to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleUtilizationError);
      expect((error as IncompatibleUtilizationError).received).toBe(7);
    }
  });
});

describe('parseUtilizationSeries', () => {
  it('preserves the real pool timelines and payload metadata', () => {
    const value = parseUtilizationSeries(utilizationJson);

    expect(value.tMs).toHaveLength(utilizationJson.t_start_ms.length);
    expect(value.series[0]).toMatchObject({
      key: utilizationJson.series[0].key,
      poolTag: utilizationJson.series[0].pool_tag,
      util: utilizationJson.series[0].util,
    });
    expect(value.workerSeries).toEqual([]);
    expect(value.gpuName).toBe(utilizationJson.meta.gpu_name);
    expect(value.averages).toEqual(utilizationJson.meta.avg);
    expect(value.definitions.metric).toBeTruthy();
  });

  it('keeps additive workers with the same id in different pools distinct', () => {
    const wire = structuredClone(utilizationJson);
    Object.assign(wire, {
      worker_series: wire.series.map((series, index) => ({
        key: `worker_${index}_0`,
        label: `${series.pool_tag}/0`,
        pool_tag: series.pool_tag,
        worker_id: 0,
        util: [...series.util],
      })),
    });

    const value = parseUtilizationSeries(wire);
    expect(value.workerSeries.map((series) => series.worker)).toEqual([
      { poolTag: 'attn', workerId: '0' },
      { poolTag: 'ffn', workerId: '0' },
    ]);
    expect(new Set(value.workerSeries.map((series) => series.key)).size).toBe(2);
  });

  it('preserves utilization above one as an overlap diagnostic', () => {
    const wire = structuredClone(utilizationJson);
    wire.series[0].util[0] = 1.2;
    Reflect.deleteProperty(wire.meta.avg, wire.series[0].key);

    expect(parseUtilizationSeries(wire).series[0].util[0]).toBe(1.2);
  });

  it('refuses a worker timeline that disagrees with its pool average', () => {
    const wire = structuredClone(utilizationJson);
    Object.assign(wire, {
      worker_series: wire.series.map((series, index) => ({
        key: `worker_${index}_0`,
        label: `${series.pool_tag}/0`,
        pool_tag: series.pool_tag,
        worker_id: 0,
        util: series.util.map((value) => value + 0.1),
      })),
    });

    expect(() => parseUtilizationSeries(wire)).toThrow(/does not match worker average/);
  });

  it('preserves the Analyzer reason when no utilization was generated', () => {
    expect(() =>
      parseUtilizationSeries({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no iterations' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
        worker_series: [],
      }),
    ).toThrow(UnavailableUtilizationError);
  });
});
