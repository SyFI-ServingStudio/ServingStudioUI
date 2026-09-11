/**
 * The existing KV chart, moved behind the memory panel boundary.
 *
 * Keep this option structurally equal to the previous `metrics/kvOption` while
 * the data source moves from the old repository to an artifact payload.
 */
import type { EChartsOption } from 'echarts';

import type { KvOccupancyTimeline } from '../../artifacts';
import {
  baseChartOption,
  cursorMarker,
  safeChartText,
  type ChartTheme,
} from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

interface KvChartData {
  readonly t_ms: readonly number[];
  readonly series: readonly {
    readonly key: string;
    readonly label: string;
    readonly poolTag: string;
    readonly capacity: number | null;
    readonly active: readonly number[];
  }[];
  readonly workerSeries: readonly {
    readonly label: string;
    readonly worker: { readonly poolTag: string };
    readonly capacity: number | null;
    readonly active: readonly number[];
  }[];
}

/** The exact input shape consumed by the pre-refactor chart. */
export function kvChartData(timeline: KvOccupancyTimeline): KvChartData {
  return {
    t_ms: timeline.tMs,
    series: timeline.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.poolTag,
      capacity: series.capacity,
      active: series.active.mean,
    })),
    workerSeries: timeline.workerSeries.map((series) => ({
      label: series.label,
      worker: series.worker,
      capacity: series.capacity,
      active: series.active,
    })),
  };
}

export function kvOption(
  timeline: KvOccupancyTimeline,
  theme: ChartTheme,
  cursorS?: number,
): EChartsOption {
  return optionFor(kvChartData(timeline), theme, cursorS);
}

/** Kept line-for-line with the previous option builder after its input adapter. */
function optionFor(kv: KvChartData, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = kv.t_ms.map((value) => +(value / 1000).toFixed(1));
  const displayedSeries = [...kv.workerSeries, ...kv.series];
  const percentMode =
    displayedSeries.length > 0 && displayedSeries.every((series) => series.capacity !== null);
  const option = baseChartOption(t);
  const poolIdentities = [
    ...new Set([
      ...kv.series.map((series) => series.poolTag ?? series.key),
      ...kv.workerSeries.map((series) => series.worker.poolTag),
    ]),
  ].sort();
  const colorFor = (identity: string): string =>
    t.palette[poolIdentities.indexOf(identity) % t.palette.length];
  const selectedWorkerOnly = kv.series.length === 0 && kv.workerSeries.length === 1;
  const displayValue = (value: number, capacity: number | null): number =>
    percentMode && capacity !== null ? +((value / capacity) * 100).toFixed(1) : value;
  const peakPercent = percentMode
    ? Math.max(
        0,
        ...displayedSeries.flatMap((series) =>
          series.active.map((value) => displayValue(value, series.capacity)),
        ),
      )
    : 0;
  const percentAxisMax = Math.max(100, Math.ceil((peakPercent * 1.05) / 5) * 5);
  return {
    ...option,
    xAxis: {
      ...(option.xAxis as object),
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(option.yAxis as object),
      ...(percentMode ? { max: percentAxisMax } : {}),
      name: percentMode ? 'KV %' : 'KV tokens',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    series: [
      ...kv.workerSeries.map((series) => {
        const color = colorFor(series.worker.poolTag);
        const label =
          series.label.startsWith(`${series.worker.poolTag}/`) ||
          series.label.startsWith(`${series.worker.poolTag} ·`)
            ? series.label
            : `${series.worker.poolTag} · ${series.label}`;
        return {
          name: safeChartText(label),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: series.active.map((value, index) => [
            x[index],
            displayValue(value, series.capacity),
          ]),
          color,
          lineStyle: {
            width: selectedWorkerOnly ? 3.4 : 1.1,
            color,
            opacity: selectedWorkerOnly ? 1 : 0.42,
          },
          emphasis: {
            focus: 'series' as const,
            lineStyle: { width: selectedWorkerOnly ? 4.2 : 2.1, opacity: 1 },
          },
          z: selectedWorkerOnly ? 4 : 2,
        };
      }),
      ...kv.series.map((series) => {
        const color = colorFor(series.poolTag ?? series.key);
        const label =
          series.label.toLowerCase() === series.poolTag.toLowerCase()
            ? series.label
            : `${series.poolTag} · ${series.label}`;
        return {
          name: safeChartText(`${label} average`),
          type: 'line' as const,
          smooth: true,
          symbol: 'none',
          data: series.active.map((value, index) => [
            x[index],
            displayValue(value, series.capacity),
          ]),
          color,
          lineStyle: { width: 3.4, color, opacity: 1 },
          z: 4,
        };
      }),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}
