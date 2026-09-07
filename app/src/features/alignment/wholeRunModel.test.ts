import { describe, expect, it } from 'vitest';

import type {
  AlignmentCdfComparison,
  AlignmentE2eSeries,
  AlignmentWorkloadSeries,
} from '../../domain/alignment';
import {
  latencyCards,
  niceStep,
  niceTicks,
  quantile,
  relativeDeltaPct,
  splitFormatted,
  throughputCard,
  workloadCards,
  workloadSummaryRows,
} from './wholeRunModel';

const curve = (
  label: string,
  x: readonly number[],
  markers: Readonly<Record<string, number>>,
): AlignmentCdfComparison['measured'] => ({
  key: `${label}-curve`,
  label,
  unit: 'ms',
  n: x.length,
  x,
  yPct: x.map((_value, index) => ((index + 1) / x.length) * 100),
  markers,
});

const comparison = (
  key: string,
  label: string,
  simulatedMarkers: Readonly<Record<string, number>>,
): AlignmentCdfComparison => ({
  key,
  label,
  unit: 'ms',
  measured: curve('Client measured', [10, 20, 30], { p50: 20, p90: 28, p99: 30 }),
  simulated: curve('Simulated', [8, 16, 24], simulatedMarkers),
});

describe('quantile', () => {
  it('interpolates linearly between order statistics, as the analyzer report does', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5, 12);
    expect(quantile([0, 10], 0.9)).toBeCloseTo(9, 12);
    expect(quantile([5], 0.99)).toBe(5);
  });

  it('sorts the sample rather than assuming the analyzer emitted it in order', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBeCloseTo(2.5, 12);
  });

  it('has no reading for an empty sample', () => {
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe('relativeDeltaPct', () => {
  it('reports the modelled side as a percentage of the measured one', () => {
    expect(relativeDeltaPct(20, 16)).toBeCloseTo(-20, 12);
  });

  it('has no reading against a zero measurement', () => {
    expect(relativeDeltaPct(0, 16)).toBeNull();
  });
});

describe('niceTicks', () => {
  it('divides a span into at most the requested number of round intervals', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 12000, 4)).toEqual([0, 5000, 10000]);
    expect(niceStep(0, 12000, 4)).toBe(5000);
  });

  it('starts at the first round position inside the span', () => {
    expect(niceTicks(21, 99, 4)).toEqual([40, 60, 80]);
  });

  it('degenerates to the single value when there is no span', () => {
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });
});

describe('splitFormatted', () => {
  it('separates a formatted quantity from its unit', () => {
    expect(splitFormatted('52.25 ms')).toEqual({ value: '52.25', unit: 'ms' });
    expect(splitFormatted('84')).toEqual({ value: '84', unit: '' });
  });
});

describe('latencyCards', () => {
  const cards = latencyCards([
    comparison('client_ttft', 'Client-observed TTFT', { p50: 16, p90: 22, p99: 24 }),
    comparison('server_ttft', 'Server engine-core TTFT', { p50: 16, p90: 22, p99: 24 }),
    comparison('e2e', 'E2E', { p50: 18, p90: 26, p99: 30 }),
  ]);

  it('titles each card and keeps the analyzer label beside it', () => {
    expect(cards.map((card) => card.title)).toEqual(['client TTFT', 'server TTFT', 'E2E']);
    expect(cards[0].label).toBe('Client-observed TTFT');
  });

  it('marks the cards that read one modelled series through two measured views', () => {
    expect(cards.map((card) => card.sharesSimulatedSeries)).toEqual([true, true, false]);
  });

  it('summarises each side independently before comparing them', () => {
    expect(cards[0].measured).toMatchObject({ p50: 20, p90: 28, p99: 30, low: 10, high: 30 });
    expect(cards[0].deltaP50Pct).toBeCloseTo((16 / 20 - 1) * 100, 12);
  });
});

describe('throughputCard', () => {
  const e2e: AlignmentE2eSeries = {
    definitions: {},
    latencyCdfComparisons: [],
    throughput: {
      tStartMs: [0, 1000],
      tEndMs: [1000, 2000],
      measuredOutputTps: [100, 200],
      simulatedOutputTps: [90, 210],
    },
    throughputSummary: {
      measured_client_completion_tps: 150,
      measured_client_completion_span_ms: 2000,
      measured_output_tokens: 300,
      simulated_completion_tps: 140,
      simulated_completion_span_ms: 2100,
      simulated_output_tokens: 300,
    },
  };

  it('takes each side`s whole-run rate from the analyzer and its peak from the bins', () => {
    const card = throughputCard(e2e);
    expect(card?.measured).toMatchObject({ tps: 150, spanMs: 2000, peakBinTps: 200 });
    expect(card?.simulated).toMatchObject({ tps: 140, peakBinTps: 210 });
    expect(card?.deltaPct).toBeCloseTo((140 / 150 - 1) * 100, 12);
    expect(card?.bins).toBe(2);
  });

  it('is null when the analysis recorded no bins', () => {
    expect(throughputCard({ ...e2e, throughput: null })).toBeNull();
  });

  it('keeps missing whole-run summary values null instead of inventing NaN', () => {
    const card = throughputCard({ ...e2e, throughputSummary: {} });
    expect(card?.measured).toMatchObject({ tps: null, spanMs: null, outputTokens: null });
    expect(card?.simulated).toMatchObject({ tps: null, spanMs: null, outputTokens: null });
    expect(card?.deltaPct).toBeNull();
  });
});

describe('workloadCards', () => {
  const workload: AlignmentWorkloadSeries = {
    available: true,
    definitions: {},
    measured: {
      iterationId: [1, 2, 3],
      timeMs: [0, 100, 200],
      iterationCycleMs: [4, 8, null],
      prefillTokens: [0, 0, 0],
      decodeBatchSize: [2, 4, 6],
      scheduledKvTokens: [10, 20, 30],
    },
    simulated: {
      iterationId: [1, 2],
      timeMs: [0, 150],
      iterationCycleMs: [5, 9],
      prefillTokens: [0, 4],
      decodeBatchSize: [3, 5],
      scheduledKvTokens: [12, 24],
    },
  };
  const cards = workloadCards(workload);

  it('drops the iterations the analyzer recorded no cycle for', () => {
    const cycle = cards.find((card) => card.key === 'iterationCycleMs');
    expect(cycle?.measured?.stats.n).toBe(2);
    expect(cycle?.simulated?.stats.n).toBe(2);
  });

  it('keeps every iteration at its exact elapsed-time coordinate', () => {
    expect(cards[0].spanMs).toBe(200);
    expect(cards[0].axisMode).toBe('elapsedTime');
    expect(cards[0].axisMax).toBe(0.2);
    expect(cards[0].measured?.points).toEqual({ x: [0, 0.1, 0.2], values: [2, 4, 6] });
  });

  it('switches to each side`s original iteration ids without pairing them', () => {
    const iterationCards = workloadCards(workload, 'iterationId');
    expect(iterationCards[0].axisMode).toBe('iterationId');
    expect(iterationCards[0].axisMin).toBe(1);
    expect(iterationCards[0].axisMax).toBe(3);
    expect(iterationCards[0].measured?.points.x).toEqual([1, 2, 3]);
    expect(iterationCards[0].simulated?.points.x).toEqual([1, 2]);
  });

  it('has no percentile ratio where the measured side is zero', () => {
    const prefill = cards.find((card) => card.key === 'prefillTokens');
    expect(prefill?.measured?.stats.p50).toBe(0);
    expect(prefill?.deltaP50Pct).toBeNull();
  });

  it('reports every metric the analyzer publishes', () => {
    expect(cards.map((card) => card.field)).toEqual([
      'decode_batch_size',
      'scheduled_kv_tokens',
      'prefill_tokens',
      'iteration_cycle_ms',
    ]);
  });

  it('summarises captures larger than the JavaScript argument limit', () => {
    const count = 150_000;
    const values = Array.from({ length: count }, (_value, index) => index);
    const largeSide = {
      iterationId: values,
      timeMs: values,
      iterationCycleMs: values,
      prefillTokens: values,
      decodeBatchSize: values,
      scheduledKvTokens: values,
    };
    const [decode] = workloadCards({
      available: true,
      definitions: {},
      measured: largeSide,
      simulated: null,
    });

    expect(decode.measured?.stats.max).toBe(count - 1);
    expect(decode.axisMax).toBe((count - 1) / 1000);
    expect(decode.spanMs).toBe(count - 1);
  });

  it('quotes the same statistics in the summary table as on the cards', () => {
    const rows = workloadSummaryRows(workload, cards);
    expect(rows.map((row) => row.label)).toEqual([
      'iterations',
      'decode batch p50',
      'scheduled KV p50',
      'prefill tok p90',
      'cycle p50 ms',
      'span ms',
    ]);
    expect(rows[0]).toMatchObject({ measured: 3, simulated: 2 });
    expect(rows[1].measured).toBe(cards[0].measured?.stats.p50);
    expect(rows[5]).toMatchObject({ measured: 200, simulated: 150 });
    expect(rows[5].simulatedFraction).toBeCloseTo(75, 12);
  });
});
