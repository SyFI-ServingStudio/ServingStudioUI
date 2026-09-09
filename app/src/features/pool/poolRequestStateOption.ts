import { chartFont } from '../../theme/metrics';
import type { EChartsOption } from 'echarts';

import {
  baseChartOption,
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';
import type { RequestState, RequestStatePoolSeries } from '../../domain/run';

function endExtended(values: number[]): number[] {
  return [...values, values[values.length - 1]];
}

/** Pool pending is intentionally shown on one request-count axis: the bold
 * aggregate exposes total pressure, while the dashed average and thin worker
 * lines preserve the scale and imbalance evidence behind that total. */
export function poolRequestStateOption(
  requestState: RequestState,
  pool: RequestStatePoolSeries,
  theme: ChartTheme,
): EChartsOption {
  const base = baseChartOption(theme);
  const xSeconds = requestState.tStartMs.map((value) => (value / 1000).toFixed(2));
  xSeconds.push((requestState.tEndMs[requestState.tEndMs.length - 1] / 1000).toFixed(2));
  const aggregateName = 'pool aggregate';
  const averageName = 'worker average';
  const workerNames = pool.workers.map((worker) =>
    safeChartText(`worker ${worker.worker.workerId}`),
  );

  return {
    ...base,
    legend: {
      ...(base.legend as object),
      data: [aggregateName, averageName, ...workerNames],
      selectedMode: 'multiple',
    },
    grid: chartGrid({ left: 62, right: 18, top: 34, bottom: 30 }),
    tooltip: richTextTooltip(theme, 'axis', {
      formatter: (params: unknown) => {
        const rows = params as Array<{ axisValue: string; seriesName: string; value: number }>;
        return tooltipLines([
          `${Number(rows[0]?.axisValue ?? 0).toFixed(1)}s`,
          ...rows.map((row) => `${row.seriesName}: ${Number(row.value ?? 0).toFixed(1)} requests`),
        ]);
      },
    }),
    xAxis: {
      type: 'category',
      data: xSeconds,
      boundaryGap: false,
      name: 's',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
      axisLine: chartAxisLine(theme),
      axisTick: { show: false },
      axisLabel: {
        color: theme.sub,
        fontSize: chartFont(11),
        formatter: (value: string) => `${+Number(value).toFixed(1)}`,
      },
      splitLine: { show: false },
    },
    yAxis: {
      ...(base.yAxis as object),
      min: 0,
      name: 'pending requests',
      nameTextStyle: { color: theme.sub, fontSize: chartFont(10) },
    },
    series: [
      {
        name: aggregateName,
        type: 'line' as const,
        color: theme.palette[1],
        step: 'end' as const,
        symbol: 'none',
        data: endExtended(pool.totalPending),
        lineStyle: { width: 2.8, color: theme.palette[1], opacity: 1 },
        z: 5,
      },
      {
        name: averageName,
        type: 'line' as const,
        color: theme.palette[0],
        step: 'end' as const,
        symbol: 'none',
        data: endExtended(pool.averagePending),
        lineStyle: { width: 2.1, color: theme.palette[0], type: 'dashed' as const, opacity: 1 },
        z: 4,
      },
      ...pool.workers.map((worker, index) => {
        const color = theme.palette[(index + 2) % theme.palette.length];
        return {
          name: workerNames[index],
          type: 'line' as const,
          color,
          step: 'end' as const,
          symbol: 'none',
          data: endExtended(worker.pending),
          lineStyle: { width: 1, color, opacity: 0.48 },
          emphasis: { focus: 'series' as const, lineStyle: { width: 2, opacity: 1 } },
          z: 2,
        };
      }),
    ],
  };
}
