import { chartFont } from '../../theme/metrics';
import { colors } from '../../theme';
import type { EChartsOption } from 'echarts';

import {
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  type ChartTheme,
} from '../../charts/platform';
import type { ReadyKernelLadderProjection } from './optimalityKernelLadder';
import { formatGpuSeconds } from './optimalityOption';

const KERNEL_PALETTE = colors.kernelLadder;

/** Stable across cluster/pool/worker/iteration projections, so drilling does
 * not silently recolor an unchanged kernel identity. */
function kernelColor(name: string): string {
  let hash = 2166136261;
  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return KERNEL_PALETTE[(hash >>> 0) % KERNEL_PALETTE.length];
}

export function optimalityKernelLadderOption(
  projection: ReadyKernelLadderProjection,
  theme: ChartTheme,
): EChartsOption {
  const identities = [
    ...projection.kernelNames.map((name) => ({
      key: name,
      label: name,
      color: kernelColor(name),
    })),
    { key: '__imbalance', label: 'imbalance (aggregate)', color: colors.ladderImbalance },
    { key: '__idle', label: 'idle (aggregate)', color: colors.ladderIdle },
    {
      key: '__globalNecessary',
      label: 'globally fused (aggregate)',
      color: colors.ladderNecessary,
    },
  ];
  return {
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: chartGrid({ left: 168, right: 24, top: 54, bottom: 42 }),
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: theme.sub, fontSize: chartFont(12) },
      itemWidth: 11,
      itemHeight: 8,
      pageTextStyle: { color: theme.sub },
    },
    tooltip: richTextTooltip(theme, 'item', {
      valueFormatter: (value) => `${formatGpuSeconds(Number(value))} GPU·s`,
    }),
    xAxis: {
      type: 'value',
      name: 'GPU·seconds',
      nameLocation: 'middle',
      nameGap: 30,
      nameTextStyle: { color: theme.sub, fontSize: chartFont(12) },
      axisLine: chartAxisLine(theme),
      axisLabel: {
        color: theme.sub,
        fontSize: chartFont(12),
        formatter: (value: number) => formatGpuSeconds(value),
      },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      // Rung name and value on separate lines: a one-line label such as
      // "R6 Segmented necessary 88.7684 GPU·µs" overflows the gutter and
      // echarts clips it from the left.
      data: projection.rows.map(
        (row) => `${safeChartText(row.label)}\n${safeChartText(formatGpuSeconds(row.total))}`,
      ),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.text,
        fontSize: 11,
        fontFamily: theme.font,
        fontWeight: 600,
        lineHeight: 14,
      },
    },
    series: identities.map((identity) => ({
      name: safeChartText(identity.label),
      type: 'bar' as const,
      stack: 'kernel-ladder',
      data: projection.rows.map((row) => row.values[identity.key] ?? 0),
      itemStyle: { color: identity.color, borderColor: theme.bg, borderWidth: 1 },
      emphasis: { focus: 'series' as const },
      blur: { itemStyle: { opacity: 0.25 } },
      barMaxWidth: 30,
    })),
  };
}
