import { describe, expect, it } from 'vitest';

import type { AlignmentCdfComparison, AlignmentThroughputSeries } from '../../domain/alignment';
import {
  expandedWholeRunOption,
  latencyCdfOption,
  throughputRateOption,
  workloadShapeOption,
} from './wholeRunOption';
import type { WorkloadCardModel } from './wholeRunModel';

const comparison: AlignmentCdfComparison = {
  key: 'client_ttft',
  label: 'Client-observed TTFT',
  unit: 'ms',
  measured: {
    key: 'client_ttft_measured',
    label: 'Client measured',
    unit: 'ms',
    n: 3,
    x: [10, 20, 30],
    yPct: [33.3, 66.6, 100],
    markers: { p50: 20, p90: 28, p99: 30 },
  },
  simulated: {
    key: 'client_ttft_simulated',
    label: 'Simulated',
    unit: 'ms',
    n: 3,
    x: [8, 16, 24],
    yPct: [33.3, 66.6, 100],
    markers: { p50: 16, p90: 22, p99: 24 },
  },
};

interface SeriesProbe {
  readonly name?: string;
  readonly type?: string;
  readonly step?: string;
  readonly stack?: string;
  readonly data?: (number | null)[][];
  readonly markLine?: { data: { yAxis?: number; xAxis?: number }[] };
}

const seriesOf = (option: unknown): SeriesProbe[] =>
  ((option as { series?: SeriesProbe[] } | null)?.series ?? []) as SeriesProbe[];

describe('latencyCdfOption', () => {
  const option = latencyCdfOption(comparison, 20);
  const series = seriesOf(option);

  it('overlays the two distributions as step curves rather than differencing them', () => {
    const curves = series.filter((entry) => entry.type === 'line' && entry.step === 'end');
    expect(curves.map((entry) => entry.name)).toEqual(['Client measured', 'Simulated']);
  });

  it('extends each curve flat from zero and out to a hundred percent', () => {
    const [measured] = series.filter((entry) => entry.step === 'end');
    const data = measured.data ?? [];
    expect(data[0][1]).toBe(0);
    expect(data[0][0]).toBeLessThan(10);
    expect(data[data.length - 1][1]).toBe(100);
    expect(data.slice(1, -1)).toEqual([
      [10, 33.3],
      [20, 66.6],
      [30, 100],
    ]);
  });

  it('places the analyzer`s percentile markers on the curve', () => {
    const markers = series.filter((entry) => entry.type === 'scatter');
    expect(markers).toHaveLength(2);
    expect(markers[0].data).toEqual([
      [20, 50],
      [28, 90],
      [30, 99],
    ]);
  });

  it('rules the percentile axis and drops a guide at the measured median', () => {
    const rules = series.find((entry) => entry.markLine !== undefined)?.markLine?.data ?? [];
    expect(rules.map((rule) => rule.yAxis).filter((value) => value !== undefined)).toEqual([
      0, 50, 90, 100,
    ]);
    expect(rules.some((rule) => rule.xAxis === 20)).toBe(true);
  });

  it('names the x axis with the analyzer`s own unit and pins the percentile axis', () => {
    expect(option?.xAxis).toMatchObject({ name: 'ms' });
    expect(option?.yAxis).toMatchObject({ min: 0, max: 100 });
  });

  it('is null when neither side recorded a sample', () => {
    expect(
      latencyCdfOption(
        {
          ...comparison,
          measured: { ...comparison.measured, x: [] },
          simulated: { ...comparison.simulated, x: [] },
        },
        null,
      ),
    ).toBeNull();
  });
});

describe('throughputRateOption', () => {
  const bins: AlignmentThroughputSeries = {
    tStartMs: [0, 1000],
    tEndMs: [1000, 2000],
    measuredOutputTps: [100, 200],
    simulatedOutputTps: [90, 210],
  };

  it('holds each bin`s rate across the whole bin', () => {
    const option = throughputRateOption(bins, { measured: 150, simulated: 150 });
    const [measured] = seriesOf(option).filter((entry) => entry.name === 'measured');
    expect(measured.data).toEqual([
      [0, 100],
      [1000, 100],
      [1000, 200],
      [2000, 200],
    ]);
  });

  it('draws each side`s whole-run rate as its own rule', () => {
    const option = throughputRateOption(bins, { measured: 150, simulated: 140 });
    const ruled = seriesOf(option)
      .flatMap((entry) => entry.markLine?.data ?? [])
      .map((rule) => rule.yAxis);
    expect(ruled).toContain(150);
    expect(ruled).toContain(140);
  });

  it('is null when the analysis recorded no bins', () => {
    expect(
      throughputRateOption(
        { tStartMs: [], tEndMs: [], measuredOutputTps: [], simulatedOutputTps: [] },
        { measured: 0, simulated: 0 },
      ),
    ).toBeNull();
  });

  it('handles more bins than can be spread into a function call', () => {
    const values = Array.from({ length: 150_000 }, (_value, index) => index % 1_000);
    const option = throughputRateOption(
      {
        tStartMs: values,
        tEndMs: values.map((value) => value + 1),
        measuredOutputTps: values,
        simulatedOutputTps: values,
      },
      { measured: null, simulated: null },
    );

    expect(option?.yAxis).toMatchObject({ max: 999 * 1.08 });
  });
});

describe('workloadShapeOption', () => {
  const card: WorkloadCardModel = {
    key: 'decodeBatchSize',
    field: 'decode_batch_size',
    label: 'decode batch',
    unit: 'decode requests',
    quantityUnit: '',
    measured: {
      stats: { n: 3, p50: 4, p90: 6, p99: 6, max: 6 },
      points: { x: [0, 3.5, 4], values: [2, 6, 4] },
    },
    simulated: null,
    deltaP50Pct: null,
    deltaP90Pct: null,
    deltaP99Pct: null,
    axisMode: 'elapsedTime',
    axisMin: 0,
    axisMax: 4,
    spanMs: 4000,
  };

  it('draws every iteration and holds its value until the next start', () => {
    const series = seriesOf(workloadShapeOption(card));
    const measured = series.find((entry) => entry.name === 'measured');
    expect(measured?.type).toBe('line');
    expect(measured?.step).toBe('end');
    expect(measured?.data).toEqual([
      [0, 2],
      [3.5, 6],
      [4, 4],
    ]);
  });

  it('draws no series for the side the analyzer did not record', () => {
    const series = seriesOf(workloadShapeOption(card));
    expect(series.some((entry) => entry.name?.startsWith('modelled'))).toBe(false);
  });

  it('labels the y axis with the metric`s own unit and the x axis with elapsed time', () => {
    const option = workloadShapeOption(card);
    expect(option?.yAxis).toMatchObject({ name: 'decode requests' });
    expect(option?.xAxis).toMatchObject({ name: 'elapsed time (s)', min: 0, max: 4 });
  });

  it('labels the alternate x axis as iteration ID', () => {
    const option = workloadShapeOption({ ...card, axisMode: 'iterationId' });
    expect(option?.xAxis).toMatchObject({ name: 'iteration ID' });
  });

  it('is null when neither side recorded a series', () => {
    expect(workloadShapeOption({ ...card, measured: null })).toBeNull();
  });

  it('handles more scheduler points than can be spread into a function call', () => {
    const values = Array.from({ length: 150_000 }, (_value, index) => index % 1_000);
    const option = workloadShapeOption({
      ...card,
      measured: {
        stats: { n: values.length, p50: 500, p90: 900, p99: 990, max: 999 },
        points: { x: values, values },
      },
    });

    expect(option?.yAxis).toMatchObject({ max: 999 * 1.08 });
  });
});

describe('expandedWholeRunOption', () => {
  it('adds wheel/drag zoom and a scrolling slider without mutating the card option', () => {
    const compact = { grid: { left: 40, bottom: 30 }, series: [] };
    const expanded = expandedWholeRunOption(compact);
    const zoom = expanded.dataZoom as { type: string; zoomOnMouseWheel?: boolean }[];

    expect(compact.grid.bottom).toBe(30);
    expect(expanded.grid).toMatchObject({ left: 40, bottom: 72 });
    expect(zoom.map((control) => control.type)).toEqual(['inside', 'slider']);
    expect(zoom[0].zoomOnMouseWheel).toBe(true);
  });
});
