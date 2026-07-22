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

const KERNEL_PALETTE = [
  '#355F8A',
  '#D17A22',
  '#3F7D5B',
  '#B24C4A',
  '#6D5A8D',
  '#2F7F7B',
  '#8A6848',
  '#9C5F78',
  '#5F6B76',
  '#B58B2A',
  '#6F8FB3',
  '#E09A5A',
  '#78A083',
  '#CB7774',
  '#9583AE',
  '#67A5A1',
  '#A58868',
  '#B98399',
  '#89949D',
  '#C6A957',
] as const;

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
    { key: '__imbalance', label: 'imbalance (aggregate)', color: '#C58AAE' },
    { key: '__idle', label: 'idle (aggregate)', color: '#B8C0CC' },
    { key: '__globalNecessary', label: 'globally fused (aggregate)', color: '#2F7F7B' },
  ];
  return {
    textStyle: { fontFamily: theme.font, color: theme.text },
    grid: chartGrid({ left: 154, right: 24, top: 54, bottom: 42 }),
    legend: {
      type: 'scroll',
      top: 0,
      left: 0,
      right: 0,
      textStyle: { color: theme.sub, fontSize: 10 },
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
      nameTextStyle: { color: theme.sub, fontSize: 10 },
      axisLine: chartAxisLine(theme),
      axisLabel: {
        color: theme.sub,
        fontSize: 11,
        formatter: (value: number) => formatGpuSeconds(value),
      },
      splitLine: { lineStyle: { color: theme.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: projection.rows.map((row) =>
        safeChartText(`${row.label}  ${formatGpuSeconds(row.total)}`),
      ),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: theme.text, fontSize: 11, fontFamily: theme.font, fontWeight: 600 },
    },
    series: identities.map((identity) => ({
      name: safeChartText(identity.label),
      type: 'bar' as const,
      stack: 'kernel-ladder',
      data: projection.rows.map((row) => row.values[identity.key] ?? 0),
      itemStyle: { color: identity.color, borderColor: theme.bg, borderWidth: 0.5 },
      barMaxWidth: 30,
    })),
  };
}
