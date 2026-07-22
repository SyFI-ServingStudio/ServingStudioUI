import type { EChartsOption } from 'echarts';

import {
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  type ChartTheme,
} from '../../charts/platform';

/** One stacked segment: a bucket key (camelCase, matching `OptimalityBuckets`) +
 * its display label and color. */
export interface OptimalityFamily {
  key: string;
  label: string;
  color: string;
}

// Stack order left→right: the irreducible optimal floor first, recoverable waste
// accumulating rightward to the Real bar length — a waterfall anchored to optimal.
export const OPTIMALITY_FAMILIES: readonly OptimalityFamily[] = [
  { key: 'hardwareOptimal', label: 'hardware-optimal', color: '#54A24B' },
  { key: 'hardwareGap', label: 'hardware gap', color: '#4C78A8' },
  { key: 'communication', label: 'communication', color: '#E45756' },
  { key: 'batching', label: 'batching', color: '#F58518' },
  { key: 'imbalance', label: 'imbalance', color: '#B279A2' },
  { key: 'idle', label: 'idle', color: '#98A2B3' },
];

/** Unlocked level bars replace the plain R5 green band with two counterfactual
 * opportunities and the irreducible global necessary-work floor. */
export const OPTIMALITY_NECESSARY_WORK_FAMILIES: readonly OptimalityFamily[] = [
  { key: 'scopeFusedNecessary', label: 'scope-fused necessary', color: '#2E7D32' },
  { key: 'fusion', label: 'fusion', color: '#7CBF66' },
  { key: 'excessOverNecessary', label: 'excess over necessary', color: '#B7D99C' },
  ...OPTIMALITY_FAMILIES.slice(1),
];

/** Kernel bars only carry the four leaf-attributable buckets (no idle/imbalance). */
export const OPTIMALITY_KERNEL_FAMILIES: readonly OptimalityFamily[] = [
  { key: 'hardwareOptimal', label: 'hardware-optimal', color: '#54A24B' },
  { key: 'hardwareGap', label: 'hardware gap', color: '#4C78A8' },
  { key: 'communication', label: 'communication', color: '#E45756' },
  { key: 'batching', label: 'batching', color: '#F58518' },
];

export const OPTIMALITY_KERNEL_NECESSARY_WORK_FAMILIES: readonly OptimalityFamily[] = [
  { key: 'necessaryCovered', label: 'necessary work', color: '#2E7D32' },
  { key: 'redundant', label: 'redundant work', color: '#A8D08D' },
  ...OPTIMALITY_KERNEL_FAMILIES.slice(1),
];

export interface OptimalityStackRow {
  label: string;
  total: number;
  /** Per-bucket GPU·s keyed by `OptimalityFamily.key`. */
  values: Record<string, number>;
  /** Optional absolute floor marker, used when necessary work exceeds R5. */
  marker?: number;
}

export interface OptimalityStackLayout {
  /** Give the scope's first row its own value axis. Pool totals are much larger
   * than individual workers, so sharing one scale can make worker composition
   * unreadable. The remaining rows continue to share one comparable scale. */
  separatePrimaryRowScale?: boolean;
  /** Normalize each row independently so its attributable buckets sum to 100%. */
  normalized?: boolean;
}

/** Preserve useful precision for exact-iteration bars, which are commonly only
 * milliseconds of aggregate GPU time. Large aggregate scopes stay compact. */
export function formatGpuSeconds(value: number): string {
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (magnitude >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  if (magnitude >= 10) return value.toFixed(1);
  if (magnitude >= 1) return value.toFixed(2);
  if (magnitude >= 0.01) return value.toFixed(3);
  if (magnitude >= 0.001) return value.toFixed(4);
  if (magnitude === 0) return '0';
  return value.toExponential(2);
}

/** Horizontal stacked bar in GPU·seconds — one bar per scope row (cluster/pool/
 * worker) or per kernel. Bars are anchored to the optimal floor at the left. */
export function optimalityStackOption(
  rows: readonly OptimalityStackRow[],
  families: readonly OptimalityFamily[],
  t: ChartTheme,
  layout: OptimalityStackLayout = {},
): EChartsOption {
  const normalized = layout.normalized ?? false;
  const cats = rows.map((row) =>
    safeChartText(`${row.label} · ${formatGpuSeconds(row.total)} GPU·s`),
  );
  if (layout.separatePrimaryRowScale && rows.length > 1) {
    return separatedPrimaryRowOption(rows, families, cats, t, normalized);
  }
  return {
    textStyle: { fontFamily: t.font, color: t.text },
    grid: chartGrid({ left: 176, right: 22, top: 30, bottom: 30 }),
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(t, 'item', {
      valueFormatter: (v) =>
        normalized ? `${Number(v).toFixed(1)}%` : `${formatGpuSeconds(Number(v))} GPU·s`,
    }),
    xAxis: {
      type: 'value',
      name: normalized
        ? 'Share of balanced GPU·seconds (%)'
        : 'GPU·seconds (waste above the optimal floor)',
      max: normalized ? 100 : undefined,
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { color: t.sub, fontSize: 10 },
      axisLine: chartAxisLine(t),
      axisLabel: {
        color: t.sub,
        fontSize: 11,
        formatter: (value: number) =>
          normalized ? `${value.toFixed(0)}%` : formatGpuSeconds(value),
      },
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
    series: [
      ...families.map((family) => ({
        name: safeChartText(family.label),
        type: 'bar' as const,
        stack: 'optimality',
        data: rows.map((row) => stackValue(row, family.key, normalized)),
        itemStyle: { color: family.color },
        barMaxWidth: 34,
      })),
      ...(rows.some((row) => row.marker !== undefined)
        ? [
            {
              name: 'under-accounted necessary work',
              type: 'scatter' as const,
              symbol: 'diamond',
              symbolSize: 11,
              data: rows.map((row, index) =>
                row.marker === undefined
                  ? '-'
                  : [
                      normalized && row.total > 0 ? (row.marker / row.total) * 100 : row.marker,
                      index,
                    ],
              ),
              itemStyle: { color: '#C62828' },
            },
          ]
        : []),
    ],
  };
}

function stackValue(row: OptimalityStackRow, familyKey: string, normalized: boolean): number {
  const value = row.values[familyKey] ?? 0;
  return normalized && row.total > 0 ? (value / row.total) * 100 : value;
}

function valueAxis(t: ChartTheme, name: string, position: 'top' | 'bottom', normalized: boolean) {
  return {
    type: 'value' as const,
    position,
    name,
    nameLocation: 'middle' as const,
    nameGap: 32,
    nameTextStyle: { color: t.sub, fontSize: 10 },
    max: normalized ? 100 : undefined,
    axisLine: chartAxisLine(t),
    axisLabel: {
      color: t.sub,
      fontSize: 11,
      formatter: (value: number) => (normalized ? `${value.toFixed(0)}%` : formatGpuSeconds(value)),
    },
    splitLine: { lineStyle: { color: t.split, type: 'dashed' as const } },
  };
}

function categoryAxis(data: string[], gridIndex: number, t: ChartTheme) {
  return {
    type: 'category' as const,
    gridIndex,
    inverse: true,
    data,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.text, fontSize: 12, fontFamily: t.font, fontWeight: 600 },
  };
}

/** Two aligned coordinate systems: the primary scope row has its own top axis,
 * while all child rows share the lower axis and remain directly comparable. */
function separatedPrimaryRowOption(
  rows: readonly OptimalityStackRow[],
  families: readonly OptimalityFamily[],
  cats: string[],
  t: ChartTheme,
  normalized: boolean,
): EChartsOption {
  const primaryRow = rows[0];
  const childRows = rows.slice(1);
  const series = [
    ...families.map((family) => ({
      name: safeChartText(family.label),
      type: 'bar' as const,
      stack: 'optimality-primary',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [stackValue(primaryRow, family.key, normalized)],
      itemStyle: { color: family.color },
      barMaxWidth: 34,
    })),
    ...families.map((family) => ({
      name: safeChartText(family.label),
      type: 'bar' as const,
      stack: 'optimality-children',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: childRows.map((row) => stackValue(row, family.key, normalized)),
      itemStyle: { color: family.color },
      barMaxWidth: 34,
    })),
  ];

  return {
    textStyle: { fontFamily: t.font, color: t.text },
    title: [
      {
        text: 'Aggregate',
        left: 16,
        top: 35,
        textStyle: { color: t.sub, fontFamily: t.font, fontSize: 11, fontWeight: 700 },
      },
      {
        text: 'Per worker',
        left: 16,
        top: 125,
        textStyle: { color: t.sub, fontFamily: t.font, fontSize: 11, fontWeight: 700 },
      },
    ],
    grid: [
      { left: 176, right: 22, top: 62, height: 42 },
      { left: 176, right: 22, top: 156, bottom: 42 },
    ],
    legend: {
      top: 0,
      right: 0,
      textStyle: { color: t.sub, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    tooltip: richTextTooltip(t, 'item', {
      valueFormatter: (v) =>
        normalized ? `${Number(v).toFixed(1)}%` : `${formatGpuSeconds(Number(v))} GPU·s`,
    }),
    xAxis: [
      {
        ...valueAxis(t, normalized ? 'Pool share (%)' : 'Pool GPU·seconds', 'top', normalized),
        gridIndex: 0,
      },
      {
        ...valueAxis(
          t,
          normalized ? 'Worker share (%)' : 'Worker GPU·seconds',
          'bottom',
          normalized,
        ),
        gridIndex: 1,
      },
    ],
    yAxis: [categoryAxis(cats.slice(0, 1), 0, t), categoryAxis(cats.slice(1), 1, t)],
    series,
  };
}
