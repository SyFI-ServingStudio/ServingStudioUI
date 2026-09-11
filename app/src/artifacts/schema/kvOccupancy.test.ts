/**
 * Four token levels, each published as an across-shard mean and max, each again
 * as a fraction of capacity. Most of these tests are about one of those figures
 * being attributed to the wrong level — which renders as a memory report that
 * is internally consistent and about something else.
 *
 * The base fixture is a two-shard pool of 1,000,000 tokens: resident peaks at
 * 600,000 averaged across shards and 900,000 on the worst one, of which 200,000
 * / 250,000 is retained prefix, with 50,000 reserved and a projection of 110%
 * on the worst shard — a pool that is not full and is already over-committed,
 * which is the case the panel exists to distinguish.
 */
import { describe, expect, it } from 'vitest';

import kvSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';

import {
  IncompatibleKvOccupancyError,
  UnavailableKvOccupancyError,
  parseKvOccupancy,
  parseKvOccupancySeries,
} from './kvOccupancy';

const CAPACITY = 1_000_000;

function series(over: Record<string, unknown> = {}) {
  const base = {
    pool_tag: 'main',
    group_id: 0,
    capacity_tokens: CAPACITY,
    n_workers: 2,
    peak_active_mean_tokens: 600_000,
    peak_active_max_tokens: 900_000,
    peak_retained_prefix_mean_tokens: 200_000,
    peak_retained_prefix_max_tokens: 250_000,
    peak_projected_mean_tokens: 800_000,
    peak_promised_max_tokens: 50_000,
    ...over,
  };
  const capacity = base.capacity_tokens as number | null;
  const pct = (tokens: unknown) =>
    capacity === null ? null : capacity > 0 ? (tokens as number) / capacity : 0;
  return {
    ...base,
    peak_active_mean_pct: pct(base.peak_active_mean_tokens),
    peak_active_max_pct: pct(base.peak_active_max_tokens),
    mean_active_pct: pct(300_000),
    peak_retained_prefix_mean_pct: pct(base.peak_retained_prefix_mean_tokens),
    peak_retained_prefix_max_pct: pct(base.peak_retained_prefix_max_tokens),
    peak_projected_mean_pct: pct(base.peak_projected_mean_tokens),
    // The one figure with no token count beside it, and the one that may be
    // above 1.
    peak_projected_max_pct: capacity === null ? null : 1.1,
    peak_promised_max_pct: pct(base.peak_promised_max_tokens),
    ...over,
  };
}

function report(over: { meta?: Record<string, unknown>; series?: unknown[] } = {}) {
  return {
    schema_version: 1,
    available: true,
    meta: {
      log_dir: 'logs/x',
      num_series: (over.series ?? [series()]).length,
      num_bins: 200,
      bin_width_ms: 300,
      span_ms: 60_000,
      has_capacity: true,
      has_retained_prefix_breakdown: true,
      ...over.meta,
    },
    totals: { per_series: over.series ?? [series()] },
    definitions: { active_tokens: 'resident/committed KV' },
  };
}

function refusal(payload: unknown): string {
  try {
    parseKvOccupancy(payload);
  } catch (error) {
    if (error instanceof IncompatibleKvOccupancyError) return error.issues.join('; ');
    throw error;
  }
  throw new Error('expected the report to be refused');
}

describe('parseKvOccupancy', () => {
  it('reads a pool that is not full and is already over-committed', () => {
    const value = parseKvOccupancy(report());
    expect(value.series).toHaveLength(1);
    const pool = value.series[0];
    expect(pool.active).toEqual({
      meanTokens: 600_000,
      meanFraction: 0.6,
      maxTokens: 900_000,
      maxFraction: 0.9,
    });
    // Every level, field by field, not one field per level. Four levels each
    // published as two views and two units is sixteen numbers that all look
    // alike, and a read that took the prefix cache's tokens off the resident
    // level renders as a memory report that is internally consistent and about
    // something else.
    expect(pool.retainedPrefix).toEqual({
      meanTokens: 200_000,
      meanFraction: 0.2,
      maxTokens: 250_000,
      maxFraction: 0.25,
    });
    expect(pool.promised).toEqual({ maxTokens: 50_000, maxFraction: 0.05 });
    expect(pool.projected.meanTokens).toBe(800_000);
    expect(pool.projected.meanFraction).toBeCloseTo(0.8, 12);
    expect(pool.meanActiveFraction).toBeCloseTo(0.3, 12);
    expect(pool.capacityTokens).toBe(CAPACITY);
    expect(pool.workers).toBe(2);
    // The projection exceeds capacity and is carried as it is: clamping it
    // would say "full" for a pool that is full and for one that is about to
    // preempt, which are different problems.
    expect(pool.projected.maxFraction).toBeCloseTo(1.1, 12);
    expect(pool.projected).not.toHaveProperty('maxTokens');
    expect(value.window).toEqual({ spanMs: 60_000, bins: 200, binWidthMs: 300 });
  });

  it('keeps a measured zero prefix as a measurement', () => {
    // The other half of "an old run's zeroes are not a measurement": a current
    // run that genuinely cached no prefixes reports the same zeroes, and those
    // *are* one. Told apart by `has_retained_prefix_breakdown` and nothing else,
    // so both directions have to be checked or the flag can be ignored.
    const value = parseKvOccupancy(
      report({
        series: [
          series({
            peak_retained_prefix_mean_tokens: 0,
            peak_retained_prefix_max_tokens: 0,
            peak_retained_prefix_mean_pct: 0,
            peak_retained_prefix_max_pct: 0,
          }),
        ],
      }),
    );
    expect(value.series[0].retainedPrefix).toEqual({
      meanTokens: 0,
      meanFraction: 0,
      maxTokens: 0,
      maxFraction: 0,
    });
  });

  it('names a single-group pool by its tag, and a split one by its group', () => {
    // The group is not addressable — the location grammar has pools and workers
    // — so the label is the only place a reader can tell two groups apart.
    expect(parseKvOccupancy(report()).series[0].label).toBe('main');
    const split = parseKvOccupancy(
      report({
        series: [series({ group_id: 0 }), series({ group_id: 1 })],
      }),
    );
    expect(split.series.map((entry) => entry.label)).toEqual(['main · g0', 'main · g1']);
  });

  it('has no prefix breakdown at all when the run did not record one', () => {
    // Not a level of zeros. An old run's compatibility column is exactly what a
    // run that cached no prefixes reports, and only one of those is a fact.
    const value = parseKvOccupancy(
      report({
        meta: { has_retained_prefix_breakdown: false },
        series: [
          series({
            peak_retained_prefix_mean_tokens: 0,
            peak_retained_prefix_max_tokens: 0,
            peak_retained_prefix_mean_pct: 0,
            peak_retained_prefix_max_pct: 0,
          }),
        ],
      }),
    );
    expect(value.series[0].retainedPrefix).toBeNull();
    // And the level that *was* measured is untouched by that.
    expect(value.series[0].active.maxTokens).toBe(900_000);
  });

  it('keeps token counts and drops fractions when no capacity was declared', () => {
    const value = parseKvOccupancy(
      report({
        meta: { has_capacity: false },
        series: [series({ capacity_tokens: null })],
      }),
    );
    expect(value.series[0].capacityTokens).toBeNull();
    expect(value.series[0].active.maxTokens).toBe(900_000);
    expect(value.series[0].active.maxFraction).toBeNull();
    expect(value.series[0].meanActiveFraction).toBeNull();
  });

  it('says a run with no KV logging is unavailable rather than failed', () => {
    expect(() =>
      parseKvOccupancy({
        schema_version: 1,
        available: false,
        reason: 'kv_snapshot/ dir not found (KV logging off or no KV pool)',
      }),
    ).toThrow(UnavailableKvOccupancyError);
  });

  it('refuses a fraction that is not the division it claims to be', () => {
    // The check that catches a figure attached to the wrong level: 900,000 of a
    // million is 0.9, and a stated 0.45 is some other pool's occupancy.
    expect(refusal(report({ series: [series({ peak_active_max_pct: 0.45 })] }))).toContain(
      'is 0.9, not the stated 0.45',
    );
  });

  it('refuses a worst shard below the average shard', () => {
    // The max series dominates the mean series in every bin, so its peak
    // cannot be lower. This is the swap that is otherwise invisible: both
    // numbers are plausible occupancies, and the wrong one is reassuring.
    expect(
      refusal(
        report({
          series: [series({ peak_active_mean_tokens: 950_000, peak_active_mean_pct: 0.95 })],
        }),
      ),
    ).toContain('below the 950000 its shards averaged');
  });

  it('refuses a prefix cache larger than what was resident', () => {
    // The prefix cache is a component of the resident total, so a breakdown
    // that exceeded it would have a negative remainder.
    expect(
      refusal(
        report({
          series: [
            series({
              peak_retained_prefix_max_tokens: 950_000,
              peak_retained_prefix_max_pct: 0.95,
            }),
          ],
        }),
      ),
    ).toContain('exceeds the 900000 tokens resident');
  });

  it('refuses an average occupancy above the peak it is an average of', () => {
    expect(refusal(report({ series: [series({ mean_active_pct: 0.7 })] }))).toContain(
      'is above the peak 0.6',
    );
  });

  it('refuses a fraction with no capacity to be a fraction of', () => {
    expect(
      refusal(
        report({
          meta: { has_capacity: false },
          series: [series({ capacity_tokens: null, peak_active_max_pct: 0.9 })],
        }),
      ),
    ).toContain('no capacity to be a fraction of');
  });

  it('refuses a fraction the report has no capacity to have divided by', () => {
    // Not only the ones with a token count beside them. The producer runs every
    // published fraction through one closure, so `mean_active_pct` and the
    // worst-shard horizon follow the same rule as the rest — and left out of
    // the loop they were the two a report could carry against a capacity it
    // says it does not know.
    expect(
      refusal(
        report({
          meta: { has_capacity: false },
          series: [series({ capacity_tokens: null, mean_active_pct: 0.3 })],
        }),
      ),
    ).toContain('mean_active_pct: no capacity to be a fraction of');
  });

  it('refuses a horizon withheld from a pool that has a capacity', () => {
    // The other direction, and the one the panel shows as "no capacity" on a
    // row that has just printed its capacity two lines above.
    expect(refusal(report({ series: [series({ peak_projected_max_pct: null })] }))).toContain(
      'peak_projected_max_pct: missing beside a capacity of 1000000',
    );
  });

  it('refuses an average occupancy withheld from a pool that has a capacity', () => {
    expect(refusal(report({ series: [series({ mean_active_pct: null })] }))).toContain(
      'mean_active_pct: missing beside a capacity of 1000000',
    );
  });

  describe('a capacity recorded as zero', () => {
    const zeroed = (over: Record<string, unknown> = {}) =>
      report({
        series: [
          series({
            capacity_tokens: 0,
            peak_active_mean_pct: 0,
            peak_active_max_pct: 0,
            mean_active_pct: 0,
            peak_retained_prefix_mean_pct: 0,
            peak_retained_prefix_max_pct: 0,
            peak_projected_mean_pct: 0,
            peak_projected_max_pct: 0,
            peak_promised_max_pct: 0,
            ...over,
          }),
        ],
      });

    it('is read as no fraction at all, not as an empty cache', () => {
      // The producer divides by a declared zero to zero rather than to
      // infinity, so this report carries 900,000 resident tokens beside 0%.
      // Read literally it is the emptiest, best-balanced, least over-committed
      // pool in the run — every one of those readings produced by the same
      // fallback.
      const pool = parseKvOccupancy(zeroed()).series[0];
      expect(pool.active.maxTokens).toBe(900_000);
      expect(pool.active.maxFraction).toBeNull();
      expect(pool.active.meanFraction).toBeNull();
      expect(pool.projected.maxFraction).toBeNull();
      expect(pool.meanActiveFraction).toBeNull();
      // And the zero itself survives, because "declared as zero" and "not
      // recorded" are different things to tell a reader.
      expect(pool.capacityTokens).toBe(0);
    });

    it('refuses a fraction that is not the zero this producer would have written', () => {
      expect(refusal(zeroed({ peak_projected_max_pct: 9 }))).toContain(
        'peak_projected_max_pct: 9 against a declared capacity of zero',
      );
    });
  });

  it('refuses a worst shard higher than the shard count allows', () => {
    // Occupancies are non-negative, so in whichever bin the worst shard peaked
    // the shards averaged at least a shard-count's fraction of it — and the
    // peak of the means is at least that. Two shards averaging 30% cannot have
    // had one at 70%.
    expect(
      refusal(
        report({
          series: [series({ peak_active_mean_tokens: 300_000, peak_active_max_tokens: 700_000 })],
        }),
      ),
    ).toContain('above the 0.6 that averaging 0.3 allows');
  });

  it('holds the shard bound on a run that declared no capacity', () => {
    // Where the bound has to be checked in tokens rather than in fractions:
    // with no declared capacity every fraction is null, so a fraction-only
    // check runs on nothing — and this is exactly the run whose panel shows
    // token counts and no percentages, so the tokens are all a reader has.
    expect(
      refusal(
        report({
          series: [
            series({
              capacity_tokens: null,
              peak_active_mean_tokens: 300_000,
              peak_active_max_tokens: 700_000,
            }),
          ],
        }),
      ),
    ).toContain('700000 tokens on one of 2 shards, above the 600000');
  });

  it('holds the shard bound on a run whose declared capacity was zero', () => {
    // The other way the fractions go missing. A capacity of zero divides every
    // fraction to zero at the source, and this build reads those as unknown —
    // so once again the token counts are the only thing left to check.
    expect(
      refusal(
        report({
          series: [
            series({
              capacity_tokens: 0,
              peak_active_mean_tokens: 300_000,
              peak_active_max_tokens: 700_000,
            }),
          ],
        }),
      ),
    ).toContain('700000 tokens on one of 2 shards, above the 600000');
  });

  it('accepts a worst shard at exactly the shard count times the average', () => {
    // One shard holding everything and the other holding nothing: the extreme
    // this bound describes, and a real state for a pool whose router sent every
    // request one way.
    const value = parseKvOccupancy(
      report({
        series: [series({ peak_active_mean_tokens: 450_000, peak_active_max_tokens: 900_000 })],
      }),
    );
    expect(value.series[0].active.maxFraction).toBeCloseTo(0.9, 12);
  });

  it('refuses a single-shard pool whose two views disagree', () => {
    // With one shard the across-shard max and the across-shard mean are the
    // same series, so the bound collapses to equality — which is what makes it
    // sharp exactly where a two-view report has the least to say.
    expect(
      refusal(
        report({
          series: [
            series({
              n_workers: 1,
              peak_active_mean_tokens: 600_000,
              peak_active_max_tokens: 900_000,
            }),
          ],
        }),
      ),
    ).toContain('above the 0.6 that averaging 0.6 allows');
  });

  it('refuses a capacity the run says nothing declared', () => {
    expect(refusal(report({ meta: { has_capacity: false } }))).toContain(
      'has_capacity is false, but a series declares a capacity',
    );
  });

  it('refuses a series listed twice', () => {
    expect(refusal(report({ series: [series(), series()] }))).toContain(
      'main/g0 appears more than once',
    );
  });

  it('refuses a pool tag that cannot be put in an address', () => {
    expect(refusal(report({ series: [series({ pool_tag: '..' })] }))).toContain(
      'cannot be put in an address',
    );
  });

  it('refuses a count in meta the list does not match', () => {
    expect(refusal(report({ meta: { num_series: 4 } }))).toContain('4 series declared, 1 listed');
  });

  it('refuses a window whose bins do not span the run', () => {
    expect(refusal(report({ meta: { bin_width_ms: 7 } }))).toContain('do not span');
  });

  it('reports a schema version it does not read', () => {
    try {
      parseKvOccupancy({ ...report(), schema_version: 3 });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleKvOccupancyError);
      expect((error as IncompatibleKvOccupancyError).received).toBe(3);
    }
  });
});

describe('parseKvOccupancySeries', () => {
  it('preserves every aggregate and worker series emitted by the Analyzer', () => {
    const value = parseKvOccupancySeries(kvSeriesJson);

    expect(value.tMs).toHaveLength(kvSeriesJson.t_start_ms.length);
    expect(value.series[0]).toMatchObject({
      key: kvSeriesJson.series[0].key,
      groupId: kvSeriesJson.series[0].group_id,
      workerCount: kvSeriesJson.series[0].n_workers,
      active: {
        mean: kvSeriesJson.series[0].active.mean,
        min: kvSeriesJson.series[0].active.min,
        max: kvSeriesJson.series[0].active.max,
      },
      projected: kvSeriesJson.series[0].projected,
      promised: kvSeriesJson.series[0].promised,
    });
    expect(value.workerSeries[0]).toMatchObject({
      worker: { poolTag: 'attn', workerId: '0' },
      active: kvSeriesJson.series[0].workers[0].active_tokens,
      projected: kvSeriesJson.series[0].workers[0].projected_tokens,
      promised: kvSeriesJson.series[0].workers[0].promised_tokens,
    });
    expect(value.sourceLogDir).toBe(kvSeriesJson.meta.log_dir);
    expect(value.definitions.aggregate).toContain('across-shard');
  });

  it('keeps an aggregate-only schema-v1 payload readable', () => {
    const wire = structuredClone(kvSeriesJson);
    wire.series.forEach((series) => Reflect.deleteProperty(series, 'workers'));

    const value = parseKvOccupancySeries(wire);
    expect(value.series).toHaveLength(wire.series.length);
    expect(value.workerSeries).toEqual([]);
  });

  it('keeps the same worker distinct across KV groups in one pool', () => {
    const wire = structuredClone(kvSeriesJson);
    const second = structuredClone(wire.series[0]);
    second.key = 'attn/g1';
    second.label = 'attn · g1';
    second.group_id = 1;
    wire.series[0].label = 'attn · g0';
    wire.series.push(second);

    const value = parseKvOccupancySeries(wire);
    const workerZero = value.workerSeries.filter((series) => series.worker.workerId === '0');
    expect(workerZero.map((series) => series.groupId)).toEqual([0, 1]);
    expect(new Set(workerZero.map((series) => series.key)).size).toBe(2);
    expect(workerZero.map((series) => series.label)).toEqual(['attn · g0/0', 'attn · g1/0']);
  });

  it('retains the additive prefix-cache breakdown when the producer measured it', () => {
    const wire = structuredClone(kvSeriesJson);
    Object.assign(wire.meta, { has_retained_prefix_breakdown: true });
    wire.series.forEach((series) => {
      Object.assign(series, { retained_prefix: structuredClone(series.active) });
      series.workers.forEach((worker) => {
        Object.assign(worker, { retained_prefix_tokens: [...worker.active_tokens] });
      });
    });

    const value = parseKvOccupancySeries(wire);
    expect(value.hasRetainedPrefixBreakdown).toBe(true);
    expect(value.series[0].retainedPrefix).toEqual(wire.series[0].active);
    expect(value.workerSeries[0].retainedPrefix).toEqual(wire.series[0].workers[0].active_tokens);
  });

  it('refuses a truncated worker series instead of drawing misaligned points', () => {
    const wire = structuredClone(kvSeriesJson);
    wire.series[0].workers[0].projected_tokens.pop();

    expect(() => parseKvOccupancySeries(wire)).toThrow(IncompatibleKvOccupancyError);
  });

  it('refuses an aggregate line that disagrees with its worker shadow lines', () => {
    const wire = structuredClone(kvSeriesJson);
    wire.series[0].active.mean[0] += 1;

    expect(() => parseKvOccupancySeries(wire)).toThrow(/does not match worker aggregate/);
  });

  it('refuses retained-prefix values above the active KV they are part of', () => {
    const wire = structuredClone(kvSeriesJson);
    Object.assign(wire.meta, { has_retained_prefix_breakdown: true });
    wire.series.forEach((series) => {
      const retained = structuredClone(series.active);
      retained.max[0] = series.active.max[0] + 1;
      Object.assign(series, { retained_prefix: retained });
      series.workers.forEach((worker) => {
        Object.assign(worker, { retained_prefix_tokens: [...worker.active_tokens] });
      });
    });

    expect(() => parseKvOccupancySeries(wire)).toThrow(/exceeds active/);
  });

  it('refuses a capacity flag that disagrees with the listed series', () => {
    const wire = structuredClone(kvSeriesJson);
    wire.meta.has_capacity = false;

    expect(() => parseKvOccupancySeries(wire)).toThrow(/has_capacity/);
  });

  it('preserves the Analyzer reason when no KV series was generated', () => {
    expect(() =>
      parseKvOccupancySeries({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no KV pool' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    ).toThrow(UnavailableKvOccupancyError);
  });
});
