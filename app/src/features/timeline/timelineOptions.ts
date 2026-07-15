import type { EChartsOption } from 'echarts';

import type { Concurrency } from '../../domain/run';
import { chartGrid, type ChartTheme } from '../../charts/platform';

/** Feature-owned backdrop for the wall-clock scrubber. */
export function concurrencySparkOption(
  concurrency: Concurrency,
  spanMs: number,
  theme: ChartTheme,
): EChartsOption {
  const seconds = concurrency.t_ms.map((value) => +(value / 1000).toFixed(2));
  return {
    grid: chartGrid({ left: 0, right: 0, top: 8, bottom: 2 }),
    xAxis: { type: 'value', show: false, min: 0, max: +(spanMs / 1000).toFixed(2) },
    yAxis: { type: 'value', show: false, min: 0, max: Math.ceil(concurrency.peak * 1.14) },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        silent: true,
        data: concurrency.active.map((value, index) => [seconds[index], value]),
        lineStyle: { width: 1.6, color: theme.palette[0], opacity: 0.6 },
        areaStyle: { color: 'rgba(31,111,107,.13)' },
      },
    ],
  };
}
