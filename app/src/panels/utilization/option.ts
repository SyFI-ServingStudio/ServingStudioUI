/** Existing utilization chart moved behind its panel boundary. */
import type { EChartsOption } from 'echarts';

import type { UtilizationTimeline } from '../../artifacts';
import {
  baseChartOption,
  cursorMarker,
  safeChartText,
  type ChartTheme,
} from '../../ui/charts/platform';
import { chartFont } from '../../ui/theme/metrics';

interface UtilizationChartData {
  readonly t_ms: readonly number[];
  readonly series: readonly {
    readonly key: string;
    readonly label: string;
    readonly poolTag: string;
    readonly util: readonly number[];
  }[];
  readonly workerSeries: readonly {
    readonly label: string;
    readonly worker: { readonly poolTag: string };
    readonly util: readonly number[];
  }[];
}

export function utilizationChartData(timeline: UtilizationTimeline): UtilizationChartData {
  return {
    t_ms: timeline.tMs,
    series: timeline.series,
    workerSeries: timeline.workerSeries,
  };
}

export function utilizationOption(
  timeline: UtilizationTimeline,
  theme: ChartTheme,
  cursorS?: number,
): EChartsOption {
  return optionFor(utilizationChartData(timeline), theme, cursorS);
}

/** Kept line-for-line with the previous option builder after its input adapter. */
function optionFor(util: UtilizationChartData, t: ChartTheme, cursorS?: number): EChartsOption {
  const x = util.t_ms.map((value) => +(value / 1000).toFixed(1));
  const option = baseChartOption(t);
  const poolIdentities = [
    ...new Set([
      ...util.series.map((series) => series.poolTag ?? series.key),
      ...util.workerSeries.map((series) => series.worker.poolTag),
    ]),
  ].sort();
  const colorFor = (identity: string): string =>
    t.palette[poolIdentities.indexOf(identity) % t.palette.length];
  const selectedWorkerOnly = util.series.length === 0 && util.workerSeries.length === 1;
  return {
    ...option,
    xAxis: {
      ...(option.xAxis as object),
      name: 's',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    yAxis: {
      ...(option.yAxis as object),
      // Keep the 100% line inside the plotting area. With a smooth, 3.4 px
      // stroke, placing 100 exactly on the clip boundary cuts saturated
      // segments and makes a continuous full-utilization interval look broken.
      max: 105,
      name: 'busy %',
      nameTextStyle: { color: t.sub, fontSize: chartFont(10) },
    },
    series: [
      ...util.workerSeries.map((series) => {
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
          data: series.util.map((value, index) => [x[index], +(value * 100).toFixed(1)]),
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
      ...util.series.map((series) => {
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
          data: series.util.map((value, index) => [x[index], +(value * 100).toFixed(1)]),
          lineStyle: { width: 3.4, color, opacity: 1 },
          z: 4,
        };
      }),
      ...(cursorS != null ? [cursorMarker(cursorS)] : []),
    ],
  };
}
