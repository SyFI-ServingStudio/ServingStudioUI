/**
 * What the throughput parser accepts, and what it refuses.
 *
 * The fixture is a run whose rate doubles halfway through, which makes every
 * derived quantity discriminating: the two segments carry different rates, the
 * two bins carry a third pair, and the totals are neither. A fixture with one
 * flat rate would let a parser that read the wrong array, or averaged when it
 * should have summed, agree with itself.
 *
 * The arithmetic, once, so the assertions below can be read:
 *
 * | window        | prefill tok | decode tok | seconds |
 * | ------------- | ----------- | ---------- | ------- |
 * | 0 – 1,000ms   |         100 |         50 |       1 |
 * | 1,000–3,000ms |         400 |        200 |       2 |
 * | whole run     |         500 |        250 |       3 |
 *
 * So the run averages 500/3 prefill and 250/3 decode, and the bins — laid out
 * edge to edge over the same three seconds, with the cumulative interpolated at
 * 1,500ms — carry 200/100 and 300/150.
 */
import { describe, expect, it } from 'vitest';

import throughputSeriesJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/throughput_segments.json';

import {
  IncompatibleRunThroughputError,
  UnavailableRunThroughputError,
  parseRunThroughput,
  parseThroughputSeries,
  runThroughputVersion,
} from './throughput';

describe('parseThroughputSeries', () => {
  it('preserves the real fine/coarse views, averages, labels, and definitions', () => {
    const value = parseThroughputSeries(throughputSeriesJson);
    expect(value).toMatchObject({
      sourceLogDir: throughputSeriesJson.meta.log_dir,
      gpuName: throughputSeriesJson.meta.gpu_name,
      gpus: throughputSeriesJson.meta.num_gpus,
      averagesPerGpu: throughputSeriesJson.meta.avg_per_gpu,
      definitions: throughputSeriesJson.definitions,
    });
    expect(value.fine.series[0]).toMatchObject({
      key: throughputSeriesJson.series[0].key,
      label: throughputSeriesJson.series[0].label,
      perGpu: throughputSeriesJson.series[0].per_gpu,
    });
    expect(value.coarse?.startMs).toEqual(throughputSeriesJson.coarse.t_start_ms);
  });

  it('keeps a minimal schema-v1 payload without coarse data, averages, or definitions readable', () => {
    const body = structuredClone(throughputSeriesJson) as Record<string, unknown> & {
      meta: Record<string, unknown>;
    };
    Reflect.deleteProperty(body, 'coarse');
    Reflect.deleteProperty(body, 'definitions');
    Reflect.deleteProperty(body.meta, 'avg_per_gpu');

    expect(parseThroughputSeries(body)).toMatchObject({
      coarse: null,
      averagesPerGpu: {},
      definitions: {},
    });
  });

  it('refuses a total series that disagrees with prefill plus decode', () => {
    const body = structuredClone(throughputSeriesJson);
    body.series[0].per_gpu[0] += 1;
    expect(() => parseThroughputSeries(body)).toThrow(/must equal prefill \+ decode/);
  });

  it('refuses an average that disagrees with the fine weighted mean', () => {
    const body = structuredClone(throughputSeriesJson);
    body.meta.avg_per_gpu.total += 1;
    expect(() => parseThroughputSeries(body)).toThrow(/does not match fine weighted mean/);
  });

  it('preserves the unavailable reason', () => {
    expect(() =>
      parseThroughputSeries({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'fewer than 2 ticks' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    ).toThrow(UnavailableRunThroughputError);
  });

  it('maps the producer ready-empty edge to unavailable', () => {
    const emptySeries = [
      { key: 'total', label: 'Total', per_gpu: [] },
      { key: 'prefill', label: 'Prefill', per_gpu: [] },
      { key: 'decode', label: 'Decode', per_gpu: [] },
    ];
    try {
      parseThroughputSeries({
        schema_version: 1,
        meta: {
          log_dir: 'logs/x',
          num_gpus: 1,
          gpu_name: '',
          unit: 'tokens/s per GPU',
          avg_per_gpu: { total: 0, prefill: 0, decode: 0 },
        },
        t_start_ms: [],
        t_end_ms: [],
        series: emptySeries,
        coarse: { t_start_ms: [], t_end_ms: [], series: emptySeries },
        definitions: {},
      });
      throw new Error('expected the empty timeline to be unavailable');
    } catch (error) {
      expect(error).toBeInstanceOf(UnavailableRunThroughputError);
      expect((error as UnavailableRunThroughputError).reason).toBe(
        'no positive-width throughput intervals',
      );
    }
  });

  it('refuses coarse intervals when the fine view is empty', () => {
    const body = structuredClone(throughputSeriesJson);
    body.t_start_ms = [];
    body.t_end_ms = [];
    body.series.forEach((series) => {
      series.per_gpu = [];
    });
    body.meta.avg_per_gpu = { total: 0, prefill: 0, decode: 0 };

    try {
      parseThroughputSeries(body);
      throw new Error('expected inconsistent empty state to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(IncompatibleRunThroughputError);
      expect((error as IncompatibleRunThroughputError).issues).toContain(
        'coarse: contains intervals while fine is empty',
      );
    }
  });

  it('refuses an empty coarse view beside non-empty fine data', () => {
    const body = structuredClone(throughputSeriesJson);
    body.coarse.t_start_ms = [];
    body.coarse.t_end_ms = [];
    body.coarse.series.forEach((series) => {
      series.per_gpu = [];
    });
    expect(() => parseThroughputSeries(body)).toThrow(/coarse: is empty/);
  });
});

const GPUS = 2;

interface Segment {
  t_start_ms: number;
  t_end_ms: number;
  prefill_tps: number;
  decode_tps: number;
  total_tps: number;
  prefill_tps_per_gpu: number;
  decode_tps_per_gpu: number;
  total_tps_per_gpu: number;
}

/** A segment built the way the producer builds one: rates, then the division. */
function segment(startMs: number, endMs: number, prefill: number, decode: number): Segment {
  const seconds = (endMs - startMs) / 1000;
  const prefillTps = prefill / seconds;
  const decodeTps = decode / seconds;
  const total = prefillTps + decodeTps;
  return {
    t_start_ms: startMs,
    t_end_ms: endMs,
    prefill_tps: prefillTps,
    decode_tps: decodeTps,
    total_tps: total,
    prefill_tps_per_gpu: prefillTps / GPUS,
    decode_tps_per_gpu: decodeTps / GPUS,
    total_tps_per_gpu: total / GPUS,
  };
}

interface Wire {
  schema_version: number;
  available: true;
  meta: {
    num_gpus: number;
    gpu_name: string;
    num_segments: number;
    num_bins: number;
    span_ms: number;
  };
  totals: {
    prefill_tokens: number;
    decode_tokens: number;
    total_tokens: number;
    prefill_tps: number;
    decode_tps: number;
    total_tps: number;
    total_tps_per_gpu: number;
  };
  segments: Segment[];
  binned_segments: Segment[];
  definitions: Record<string, string>;
}

function body(): Wire {
  const segments = [segment(0, 1000, 100, 50), segment(1000, 3000, 400, 200)];
  const bins = [segment(0, 1500, 200, 100), segment(1500, 3000, 300, 150)];
  const span = 3;
  return {
    schema_version: 1,
    available: true,
    meta: {
      num_gpus: GPUS,
      gpu_name: 'NVIDIA H200',
      num_segments: segments.length,
      num_bins: bins.length,
      span_ms: 3000,
    },
    totals: {
      prefill_tokens: 500,
      decode_tokens: 250,
      total_tokens: 750,
      prefill_tps: 500 / span,
      decode_tps: 250 / span,
      total_tps: 750 / span,
      total_tps_per_gpu: 750 / span / GPUS,
    },
    segments,
    binned_segments: bins,
    definitions: { total_tps: 'prefill_tps + decode_tps' },
  };
}

function refusal(wire: unknown): IncompatibleRunThroughputError {
  try {
    parseRunThroughput(wire);
  } catch (error) {
    if (error instanceof IncompatibleRunThroughputError) return error;
    throw error;
  }
  throw new Error('expected the report to be refused');
}

describe('parseRunThroughput', () => {
  it('reads the totals, the segments and what they were measured on', () => {
    const value = parseRunThroughput(body());

    expect(value.prefill).toEqual({ tokens: 500, perSecond: 500 / 3, perGpu: 500 / 3 / GPUS });
    expect(value.decode).toEqual({ tokens: 250, perSecond: 250 / 3, perGpu: 250 / 3 / GPUS });
    expect(value.total).toEqual({ tokens: 750, perSecond: 250, perGpu: 125 });

    // Both segments, in order, with the rates the producer published rather
    // than a re-derivation: a parser that recomputed them from the tokens would
    // agree with a report whose own arithmetic was wrong.
    expect(value.segments).toEqual([
      { startMs: 0, endMs: 1000, prefillPerSecond: 100, decodePerSecond: 50, totalPerSecond: 150 },
      {
        startMs: 1000,
        endMs: 3000,
        prefillPerSecond: 200,
        decodePerSecond: 100,
        totalPerSecond: 300,
      },
    ]);

    expect(value.spanSeconds).toBe(3);
    expect(value.gpus).toBe(2);
    expect(value.gpuName).toBe('NVIDIA H200');
    // A count, not the bins. This build reads the segments; the count is here
    // so the panel can say which view its numbers came from.
    expect(value.bins).toBe(2);
    expect(value.definitions).toEqual({ total_tps: 'prefill_tps + decode_tps' });
  });

  it('reads an empty GPU name as a missing name, not as a missing count', () => {
    // `read_run_meta` takes the count from `num_gpus` and the name from
    // `gpus[0].name`, so a sidecar of `{"num_gpus": 4}` publishes four GPUs and
    // no name — and those four are what every rate here was divided by. Reading
    // the empty name as "the count was assumed" would put "assumed one GPU"
    // beside a figure that is a quarter of the cluster's.
    const wire = body();
    wire.meta.gpu_name = '';

    const value = parseRunThroughput(wire);
    expect(value.gpuName).toBeNull();
    expect(value.gpus).toBe(GPUS);
    expect(value.total.perGpu).toBe(value.total.perSecond / GPUS);
  });

  it('reads a single-GPU report with no name as one undivided GPU', () => {
    // The other document that arrives with an empty name: no `run_meta.json` at
    // all, which the producer reports as one GPU. Indistinguishable here from a
    // genuine single-GPU run whose sidecar named no card, which is why nothing
    // downstream is told which one it was.
    const wire = body();
    wire.meta.gpu_name = '';
    wire.meta.num_gpus = 1;
    for (const list of [wire.segments, wire.binned_segments]) {
      for (const item of list) {
        item.prefill_tps_per_gpu = item.prefill_tps;
        item.decode_tps_per_gpu = item.decode_tps;
        item.total_tps_per_gpu = item.total_tps;
      }
    }
    wire.totals.total_tps_per_gpu = wire.totals.total_tps;

    const value = parseRunThroughput(wire);
    expect(value.gpuName).toBeNull();
    expect(value.gpus).toBe(1);
    expect(value.total.perGpu).toBe(value.total.perSecond);
  });

  it('says the analysis has nothing, with the reason it gave', () => {
    // Two reasons reach this and both are ordinary: no request_state at all,
    // and fewer than two ticks, which has no interval to difference.
    for (const reason of [
      'request_state.parquet not found',
      'fewer than 2 request_state snapshot ticks (no segment to diff)',
    ]) {
      expect(() => parseRunThroughput({ schema_version: 1, available: false, reason })).toThrow(
        UnavailableRunThroughputError,
      );
    }
  });

  it('reports the version a future report claims', () => {
    const wire = { ...body(), schema_version: 2 };
    expect(runThroughputVersion(wire)).toBe(2);
    expect(refusal(wire).received).toBe(2);
  });

  it('refuses a segment that does not end after it starts', () => {
    // The producer skips these rather than publishing them, so one here did not
    // come from `build_segments` — and whatever rate it carries was divided by
    // that width.
    const wire = body();
    wire.segments[1] = { ...wire.segments[1], t_end_ms: 1000 };
    expect(refusal(wire).issues.join('\n')).toContain('which is not after');
  });

  it('refuses segments with a gap between them', () => {
    // They are `windows(2)` over one boundary list, so each one's end is the
    // next one's start. A gap is a segment that was dropped somewhere between
    // the analysis and here, and the tokens in it are missing from a series a
    // reader will read as continuous.
    const wire = body();
    wire.segments[1] = { ...wire.segments[1], t_start_ms: 1200 };
    expect(refusal(wire).issues.join('\n')).toContain('leaving a gap after 1000');
  });

  it('refuses a segment whose total is not its parts', () => {
    const wire = body();
    wire.segments[0] = { ...wire.segments[0], total_tps: 200 };
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('segments[0] totals 200');
    expect(issues).toContain('prefill 100');
  });

  it('refuses a per-GPU rate that is not the rate divided by the GPUs', () => {
    // The one figure on the panel that is a division rather than a
    // measurement. A per-GPU rate that does not divide is a cluster rate
    // wearing a per-GPU label, which reads as four times the hardware.
    const wire = body();
    wire.segments[0] = { ...wire.segments[0], decode_tps_per_gpu: 50 };
    expect(refusal(wire).issues.join('\n')).toContain('decode is 50 but 50 per GPU across 2 GPUs');
  });

  it('refuses an undivided prefill or total the same way it refuses decode', () => {
    // One case per series, because the three are three fields and a check that
    // only reached one of them would leave the other two on screen undivided.
    // The panel prints all three side by side, so a reader comparing them has
    // no way to see that one of them was never divided.
    const prefill = body();
    prefill.segments[0] = { ...prefill.segments[0], prefill_tps_per_gpu: 100 };
    expect(refusal(prefill).issues.join('\n')).toContain(
      'prefill is 100 but 100 per GPU across 2 GPUs',
    );

    const total = body();
    total.segments[0] = { ...total.segments[0], total_tps_per_gpu: 150 };
    expect(refusal(total).issues.join('\n')).toContain(
      'total is 150 but 150 per GPU across 2 GPUs',
    );
  });

  it('refuses a headline per-GPU rate that is not the headline divided', () => {
    // The figure the panel leads with on a multi-GPU run, and the one the
    // reader compares against a GPU's datasheet. It has its own check because
    // it is its own field: the per-segment divisions can all be right while
    // this one is the cluster rate.
    const wire = body();
    wire.totals.total_tps_per_gpu = wire.totals.total_tps;
    expect(refusal(wire).issues.join('\n')).toContain(
      `totals.total_tps_per_gpu ${wire.totals.total_tps} across 2 GPUs is not the total rate`,
    );
  });

  it('checks the coarse bins by the same rules as the measured segments', () => {
    // The bins are a second array of the same shape and this build does not
    // draw them, but a report whose trend view is broken is a report whose
    // producer is broken, and the next build to read them would inherit it.
    const wire = body();
    wire.binned_segments[1] = { ...wire.binned_segments[1], total_tps: 1 };
    expect(refusal(wire).issues.join('\n')).toContain('binned_segments[1] totals 1');
  });

  it('refuses bins that cover a different window from the run', () => {
    // The edges are laid out across the whole tick range, so they span exactly
    // `span_ms`. Bins over some other window would be a smoothing of a
    // different run, and nothing on screen puts the two on one axis.
    const wire = body();
    wire.binned_segments = [segment(0, 1000, 200, 100), segment(1000, 2000, 300, 150)];
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('binned_segments cover 2000ms but meta.span_ms is 3000');
    expect(issues).toContain('binned_segments end at 2000 and segments end at 3000');
  });

  it('refuses counts that disagree with the arrays they count', () => {
    const wire = body();
    wire.meta.num_segments = 7;
    wire.meta.num_bins = 9;
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('meta.num_segments is 7 but 2 segments were sent');
    expect(issues).toContain('meta.num_bins is 9 but 2 bins were sent');
  });

  it('refuses totals whose parts do not add up', () => {
    const wire = body();
    wire.totals.total_tokens = 900;
    expect(refusal(wire).issues.join('\n')).toContain('totals.total_tokens is 900');
  });

  it('refuses a total rate that is not its two rates added', () => {
    const wire = body();
    wire.totals.total_tps = 300;
    wire.totals.total_tps_per_gpu = 150;
    expect(refusal(wire).issues.join('\n')).toContain('totals.total_tps is 300');
  });

  it('refuses a headline rate that its own segments do not account for', () => {
    // The check that ties the two halves together. `Σ rate × dt` is how the
    // producer accumulated the totals, so a disagreement means the headline is
    // not about the series printed under it — and the two are never on screen
    // in the same units, so nobody would see it.
    const wire = body();
    wire.segments = [segment(0, 1000, 100, 50), segment(1000, 3000, 100, 200)];
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('totals.prefill_tokens is 500, but the segments account for 200');
    // And not the decode series, which still adds up. A message that named both
    // would send a reader looking at the half that is fine.
    expect(issues).not.toContain('totals.decode_tokens');
  });

  it('ties the decode headline to its own segments too', () => {
    // The mirror of the case above. Prefill is the series the other case
    // breaks, so a conservation check that only summed prefill would pass
    // everything here — and decode is the series the panel calls the tokens a
    // reader waited for.
    const wire = body();
    wire.segments = [segment(0, 1000, 100, 50), segment(1000, 3000, 400, 100)];
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('totals.decode_tokens is 250, but the segments account for 150');
    expect(issues).not.toContain('totals.prefill_tokens');
  });

  it('holds the tolerance relative where the quantities are tiny', () => {
    // A run whose whole measured throughput is a few nanotokens per second is
    // an ordinary document — a subject that barely moved inside a long window —
    // and its arithmetic has to hold to the same *proportion* as everyone
    // else's. An absolute floor anywhere in the comparison would swallow this
    // one percent, which is the size of error that has to be caught here.
    const tiny = segment(0, 1000, 1e-9, 1e-9);
    const wire: Wire = {
      ...body(),
      meta: { ...body().meta, num_segments: 1, num_bins: 1, span_ms: 1000 },
      totals: {
        prefill_tokens: 1e-9,
        decode_tokens: 1.01e-9,
        total_tokens: 2.01e-9,
        prefill_tps: 1e-9,
        decode_tps: 1.01e-9,
        total_tps: 2.01e-9,
        total_tps_per_gpu: 2.01e-9 / GPUS,
      },
      segments: [tiny],
      binned_segments: [tiny],
    };
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('totals.decode_tokens is 1.01e-9');
    expect(issues).not.toContain('totals.prefill_tokens');
  });

  it('refuses a rate that is not its tokens over the published span', () => {
    const wire = body();
    wire.meta.span_ms = 6000;
    const issues = refusal(wire).issues.join('\n');
    // Both series, because both are published rates and a check that reached
    // only one of them would leave the other's headline unchecked.
    expect(issues).toContain('totals.prefill_tps is');
    expect(issues).toContain('500 tokens over 6s');
    expect(issues).toContain('totals.decode_tps is');
    expect(issues).toContain('250 tokens over 6s');
  });

  it('refuses a decode rate that its own tokens and span do not give', () => {
    // The same check with nothing else disturbed: the span is the one the
    // segments cover and only the published decode rate is wrong. A report like
    // this prints a decode figure that its own token count contradicts, and the
    // two are never shown together.
    const wire = body();
    wire.totals.decode_tps = 100;
    wire.totals.total_tps = wire.totals.prefill_tps + 100;
    wire.totals.total_tps_per_gpu = wire.totals.total_tps / GPUS;
    const issues = refusal(wire).issues.join('\n');
    expect(issues).toContain('totals.decode_tps is 100');
    expect(issues).not.toContain('totals.prefill_tps is');
  });

  it('refuses segments that do not cover the span the report publishes', () => {
    // `span_ms` is the last tick minus the first, and the segments are the
    // intervals between those same ticks, so they measure the same window. A
    // report that measured one second and published two divides its totals by
    // the wrong number: half the rate its own segments carry, presented as the
    // rate the run held.
    const wire = body();
    wire.segments = [segment(1000, 2000, 100, 50)];
    wire.binned_segments = [];
    wire.meta.num_segments = 1;
    wire.meta.num_bins = 0;
    wire.meta.span_ms = 2000;
    wire.totals = {
      prefill_tokens: 100,
      decode_tokens: 50,
      total_tokens: 150,
      prefill_tps: 50,
      decode_tps: 25,
      total_tps: 75,
      total_tps_per_gpu: 75 / GPUS,
    };
    // Every other check passes: the one segment divides correctly, the totals
    // are its tokens, and 150 tokens over the published two seconds is the
    // published 75 tok/s. Only the second that was never measured is missing.
    const issues = refusal(wire).issues;
    expect(issues.join('\n')).toContain('segments cover 1000ms but meta.span_ms is 2000');
    expect(issues).toHaveLength(1);
  });

  it('refuses a negative rate', () => {
    // The producer clamps the token deltas at zero, so a negative rate is not a
    // run that un-generated tokens — it is a row that did not come from there.
    const wire = body();
    wire.segments[0] = { ...wire.segments[0], decode_tps: -1 };
    expect(refusal(wire).issues.join('\n')).toContain('segments.0.decode_tps');
  });

  it('refuses a report that claims to be available with no segments', () => {
    const wire = { ...body(), segments: [] };
    expect(refusal(wire).issues.join('\n')).toContain('segments');
  });

  it('refuses a GPU count of zero, which nothing can be divided by', () => {
    const wire = body();
    wire.meta.num_gpus = 0;
    expect(refusal(wire).issues.join('\n')).toContain('num_gpus');
  });

  it('refuses a field the producer does not write', () => {
    // Strict on the segments, because a new field there is a new quantity per
    // interval and reading the old ones as if nothing changed is how a schema
    // drifts silently.
    const wire = body();
    (wire.segments[0] as unknown as Record<string, unknown>).median_tps = 1;
    expect(refusal(wire).issues.join('\n')).toContain('median_tps');
  });
});
