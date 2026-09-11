/**
 * Every fixture here is the shape the Analyzer actually serves, copied from a
 * live read. A schema tested against an invented body proves only that the
 * schema agrees with the test.
 */
import { describe, expect, it } from 'vitest';

import sloGeneralJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';

import { IncompatibleRunOverviewError, parseRunLatency, parseRunSummary } from './runOverview';

/** As served by `runs/{id}/subjects/summary/report`. */
const SUMMARY = {
  cause: 'DrainComplete',
  completed_req_s: 0.9995488364529214,
  decode_tok_s: 255.88450213194787,
  decode_tokens: 131072,
  num_gpus: 1,
  prefill_tok_s: 1023.5380085277916,
  prefill_tokens: 524288,
  realtime_x: 2479.339743026472,
  requests_finished: 512,
  requests_total: 512,
  sim_ms: 512231.1,
  total_tok_s: 1279.4225106597394,
  total_tok_s_per_gpu: 1279.4225106597394,
  total_tokens: 655360,
  wall_s: 0.206599802,
};

function latencySeries(key: string, label: string, unit: string) {
  return {
    key,
    label,
    unit,
    n: 512,
    markers: { p50: 25.7, p90: 27.5, p99: 27.9 },
    x: [23.0, 27.9],
    y_pct: [50, 100],
  };
}

/** As served by `runs/{id}/subjects/slo-general/payload`, CDFs included. */
const LATENCY = {
  schema_version: 1,
  meta: { log_dir: 'logs/run/rate1', max_cdf_points: 1000 },
  definitions: { ttft: 'first_token_time - arrival' },
  series: [
    latencySeries('ttft', 'TTFT', 'ms'),
    latencySeries('tpot', 'TPOT', 'ms/token'),
    latencySeries('e2e', 'E2E', 'ms'),
  ],
};

describe('parseRunSummary', () => {
  it('reads the simulator’s own report', () => {
    const summary = parseRunSummary(SUMMARY);
    expect(summary.totalTokensPerSecond).toBeCloseTo(1279.42);
    expect(summary.gpus).toBe(1);
    expect(summary.cause).toBe('DrainComplete');
  });

  it('rejects a field this build has never seen', () => {
    // The summary is written fresh by the simulator that produced the run, in
    // the same release. An unknown field means the contract moved, and failing
    // is how that gets noticed while it is still one release old.
    expect(() => parseRunSummary({ ...SUMMARY, new_field: 1 })).toThrow();
  });

  it('rejects tokens that do not add up', () => {
    // Two of the three are read as separate figures; a body where they
    // disagree is one where at least one of them is not what it says.
    expect(() => parseRunSummary({ ...SUMMARY, total_tokens: 1 })).toThrow(
      IncompatibleRunOverviewError,
    );
  });

  it('rejects more requests finished than were started', () => {
    expect(() => parseRunSummary({ ...SUMMARY, requests_finished: 513 })).toThrow(
      IncompatibleRunOverviewError,
    );
  });
});

describe('parseRunLatency', () => {
  it('reads the complete Analyzer fixture without dropping its CDFs', () => {
    const latency = parseRunLatency(sloGeneralJson);
    expect(latency.series.map((series) => series.key)).toEqual(['ttft', 'tpot', 'e2e']);
    expect(latency.series[0].x).toHaveLength(64);
    expect(latency.series[0].yPct.at(-1)).toBe(100);
  });

  it('keeps the markers and CDF columns', () => {
    const latency = parseRunLatency(LATENCY);
    expect(latency.series).toHaveLength(3);
    expect(latency.series[0]).toMatchObject({ key: 'ttft', unit: 'ms', count: 512 });
    expect(latency.series[0].markers?.p50).toBeCloseTo(25.7);
    expect(latency.series[0].x).toEqual([23, 27.9]);
    expect(latency.series[0].yPct).toEqual([50, 100]);
  });

  it('tolerates producer metadata beyond the CDF contract', () => {
    const grown = {
      ...LATENCY,
      series: [{ ...LATENCY.series[0], bins: [1, 2] }, ...LATENCY.series.slice(1)],
    };
    expect(parseRunLatency(grown).series).toHaveLength(3);
  });

  it('refuses a schema version it does not read', () => {
    expect(() => parseRunLatency({ ...LATENCY, schema_version: 2 })).toThrow(
      IncompatibleRunOverviewError,
    );
  });

  it('refuses percentiles that do not increase', () => {
    // Three numbers read as p50/p90/p99 by position: nothing else in the
    // payload would give away that they are not.
    const wrong = {
      ...LATENCY,
      series: [
        { ...LATENCY.series[0], markers: { p50: 30, p90: 27.5, p99: 27.9 } },
        ...LATENCY.series.slice(1),
      ],
    };
    expect(() => parseRunLatency(wrong)).toThrow(IncompatibleRunOverviewError);
  });

  it('refuses missing, duplicate, or malformed CDF series', () => {
    expect(() => parseRunLatency({ ...LATENCY, series: LATENCY.series.slice(0, 2) })).toThrow(
      /missing required e2e/,
    );
    expect(() =>
      parseRunLatency({ ...LATENCY, series: [...LATENCY.series, LATENCY.series[0]] }),
    ).toThrow(/duplicate key ttft/);
    expect(() =>
      parseRunLatency({
        ...LATENCY,
        series: [{ ...LATENCY.series[0], y_pct: [100] }, ...LATENCY.series.slice(1)],
      }),
    ).toThrow(/different lengths/);
  });

  it('checks the CDF semantics the chart relies on', () => {
    const replaceTtft = (change: object) => ({
      ...LATENCY,
      series: [{ ...LATENCY.series[0], ...change }, ...LATENCY.series.slice(1)],
    });
    expect(() => parseRunLatency(replaceTtft({ unit: 's' }))).toThrow(/expected ms/);
    expect(() => parseRunLatency(replaceTtft({ x: [27.9, 23] }))).toThrow(/not non-decreasing/);
    expect(() => parseRunLatency(replaceTtft({ y_pct: [100, 50] }))).toThrow(/not non-decreasing/);
    expect(() => parseRunLatency(replaceTtft({ y_pct: [50, 101] }))).toThrow(/outside 0-100/);
    expect(() => parseRunLatency(replaceTtft({ n: 1 }))).toThrow(/2 points for only 1 samples/);
    expect(() => parseRunLatency(replaceTtft({ y_pct: [50, 99] }))).toThrow(/end at 100/);
    expect(() =>
      parseRunLatency(replaceTtft({ markers: { p50: 1, p90: 27.5, p99: 27.9 } })),
    ).toThrow(/outside the latency range/);
    expect(() =>
      parseRunLatency(replaceTtft({ x: [23, 23], markers: { p50: 23, p90: 23, p99: 23 } })),
    ).not.toThrow();
  });

  it('keeps producer-empty metrics explicit without hiding nonempty curves', () => {
    const emptyTpot = {
      ...LATENCY,
      series: [
        LATENCY.series[0],
        {
          ...LATENCY.series[1],
          n: 0,
          markers: { p50: null, p90: null, p99: null },
          x: [],
          y_pct: [],
        },
        LATENCY.series[2],
      ],
    };
    const latency = parseRunLatency(emptyTpot);
    expect(latency.series.find((series) => series.key === 'tpot')).toMatchObject({
      count: 0,
      markers: null,
      x: [],
      yPct: [],
    });

    const allEmpty = {
      ...LATENCY,
      series: LATENCY.series.map((series) => ({
        ...series,
        n: 0,
        markers: { p50: null, p90: null, p99: null },
        x: [],
        y_pct: [],
      })),
    };
    expect(parseRunLatency(allEmpty).series.every((series) => series.markers === null)).toBe(true);
    expect(() =>
      parseRunLatency({
        ...emptyTpot,
        series: [
          emptyTpot.series[0],
          {
            ...emptyTpot.series[1],
            markers: { p50: null, p90: 2, p99: null },
          },
          emptyTpot.series[2],
        ],
      }),
    ).toThrow(/markers/);
    expect(() =>
      parseRunLatency({
        ...LATENCY,
        series: [{ ...LATENCY.series[0], x: [], y_pct: [] }, ...LATENCY.series.slice(1)],
      }),
    ).toThrow(/has samples but no CDF values/);
  });

  it('reports structural CDF errors as versioned incompatibilities', () => {
    const missing = structuredClone(LATENCY);
    Reflect.deleteProperty(missing.series[0], 'y_pct');
    try {
      parseRunLatency(missing);
      throw new Error('expected parseRunLatency to reject the payload');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleRunOverviewError);
      expect(error).toMatchObject({
        received: 1,
        issues: expect.arrayContaining([expect.stringMatching(/y_pct/)]),
      });
    }
  });
});
