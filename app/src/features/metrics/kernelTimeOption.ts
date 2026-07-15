import type { EChartsOption } from 'echarts';

import { KERNEL_TIME_EPSILON_MS } from '../../domain/kernelTimeShare';
import {
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  type ChartTheme,
} from '../../charts/platform';
import type { ReadyKernelTimeBreakdown } from './kernelTimeBreakdown';

// ---- cluster kernel time breakdown — 100% stacked bar (cluster scope) ------
export function kernelTimeStackOption(
  data: ReadyKernelTimeBreakdown,
  t: ChartTheme,
): EChartsOption {
  const formatTotal = (totalMs: number): string => {
    if (totalMs >= 1_000_000) return `${(totalMs / 1_000_000).toFixed(2)}M ms`;
    if (totalMs >= 1_000) return `${(totalMs / 1_000).toFixed(2)}K ms`;
    return `${totalMs.toFixed(2)} ms`;
  };
  const cats = data.rows.map((r) => safeChartText(`${r.label} · ${formatTotal(r.total)}`));
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: chartGrid({ left: 156, right: 22, top: 30, bottom: 28 }),
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(t, 'axis', {
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => `${Number(v).toFixed(1)}%`,
    }),
    xAxis: {
      type: 'value',
      max: 100,
      name: '% of CostTree root kernel time',
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: chartAxisLine(t),
      axisLabel: { color: t.sub, fontSize: 11, formatter: '{value}%' },
      splitLine: { lineStyle: { color: t.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: cats,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.text, fontSize: 12, fontFamily: t.font, fontWeight: 600 },
    },
    series: data.families.map((f) => ({
      name: safeChartText(f.label),
      type: 'bar' as const,
      stack: 'kernel',
      data: data.rows.map((r) =>
        r.total > KERNEL_TIME_EPSILON_MS ? ((r.byGroup[f.group] ?? 0) / r.total) * 100 : 0,
      ),
      itemStyle: { color: f.color },
      barMaxWidth: 34,
    })),
  };
}
