import type { EChartsOption } from 'echarts';

import {
  chartAxisLine,
  chartGrid,
  chartValueAxis,
  richTextTooltip,
  safeChartText,
  tooltipLines,
  type ChartTheme,
} from '../../charts/platform';
import type { KernelInputPosition } from '../../domain/kernelInputDistribution';
import type { JsonValue } from '../../domain/cost-tree';

function pointSize(count: number): number {
  return Math.min(17, 6 + Math.log2(Math.max(1, count)) * 1.6);
}

const DENSITY_GRID_POINTS = 96;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

interface DensitySeries {
  readonly backendIndex: number;
  readonly points: [number, number][];
}

function insertAggregates(features: Map<string, number>, prefix: string, values: number[]) {
  if (values.length === 0) return;
  const sum = values.reduce((total, value) => total + value, 0);
  features.set(`${prefix}.sum`, sum);
  features.set(`${prefix}.mean`, sum / values.length);
  features.set(`${prefix}.min`, Math.min(...values));
  features.set(`${prefix}.max`, Math.max(...values));
}

/** Mirrors Analyzer's input flattener so an exact CostTree input can share the
 * aggregate subject's directly reproducible feature axes. PCA remains excluded:
 * its payload does not publish the fitted transform needed for a new point. */
function flattenCurrentInput(input: JsonValue): ReadonlyMap<string, number> {
  const features = new Map<string, number>();
  const visit = (value: JsonValue, prefix: string) => {
    const key = prefix.length === 0 ? 'value' : prefix;
    if (typeof value === 'number') {
      features.set(key, value);
    } else if (typeof value === 'boolean') {
      features.set(key, value ? 1 : 0);
    } else if (Array.isArray(value)) {
      features.set(`${prefix}.count`, value.length);
      if (value.length === 0) return;
      if (value.every((entry): entry is number => typeof entry === 'number')) {
        insertAggregates(features, prefix, value);
        return;
      }
      const rows = value.filter((entry): entry is readonly JsonValue[] => Array.isArray(entry));
      const width = rows[0]?.length ?? 0;
      if (
        rows.length === value.length &&
        width > 0 &&
        rows.every(
          (row) => row.length === width && row.every((entry) => typeof entry === 'number'),
        )
      ) {
        for (let column = 0; column < width; column += 1) {
          insertAggregates(
            features,
            `${prefix}.${column}`,
            rows.map((row) => row[column] as number),
          );
        }
        return;
      }
      const records = value.filter(
        (entry): entry is { readonly [key: string]: JsonValue } =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      );
      if (records.length === value.length) {
        for (const field of Object.keys(records[0] ?? {})) {
          const column = records.map((record) => record[field]);
          if (column.every((entry): entry is number => typeof entry === 'number')) {
            insertAggregates(features, `${prefix}.${field}`, column);
          }
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [field, child] of Object.entries(value)) {
        visit(child, prefix.length === 0 ? field : `${prefix}.${field}`);
      }
    }
  };
  visit(input, '');
  return features;
}

function currentProjection(
  position: KernelInputPosition,
  currentInput: JsonValue,
): readonly [number, number] | null {
  if (position.projection === 'pca') return null;
  if (position.projection === 'categorical') return [0, 0];
  const features = flattenCurrentInput(currentInput);
  const x = features.get(position.axisLabels[0]);
  if (x === undefined) return null;
  if (position.projection === 'feature_1d') return [x, 0];
  const y = features.get(position.axisLabels[1]);
  return y === undefined ? null : [x, y];
}

/** Weighted Gaussian KDE over the shared X domain. Each backend divides by the
 * global slot count, so its curve area equals its selection ratio and all curves
 * together integrate to one probability distribution. */
function oneDimensionalDensity(position: KernelInputPosition): readonly DensitySeries[] {
  const totalWeight = position.points.reduce((sum, point) => sum + point.count, 0);
  if (totalWeight <= 0) return [];
  const mean =
    position.points.reduce((sum, point) => sum + point.x * point.count, 0) / totalWeight;
  const variance =
    position.points.reduce(
      (sum, point) => sum + (point.x - mean) ** 2 * point.count,
      0,
    ) / totalWeight;
  const xs = position.points.map((point) => point.x);
  const rawMin = Math.min(...xs);
  const rawMax = Math.max(...xs);
  const range = rawMax - rawMin;
  const scale = Math.max(Math.sqrt(variance), range / 6, Math.abs(mean) * 1e-6, 1e-9);
  const bandwidth = Math.max(1.06 * scale * totalWeight ** -0.2, range / 80, 1e-9);
  const min = rawMin - 3 * bandwidth;
  const max = rawMax + 3 * bandwidth;
  const step = (max - min) / (DENSITY_GRID_POINTS - 1);

  return position.selection.map((selection) => {
    const samples = position.points.filter(
      (point) => point.backendIndex === selection.backendIndex,
    );
    const points = Array.from({ length: DENSITY_GRID_POINTS }, (_, index) => {
      const x = min + step * index;
      const weightedKernel = samples.reduce((sum, sample) => {
        const z = (x - sample.x) / bandwidth;
        return sum + sample.count * Math.exp(-0.5 * z * z);
      }, 0);
      return [x, weightedKernel / (totalWeight * bandwidth * SQRT_TWO_PI)] as [number, number];
    });
    return { backendIndex: selection.backendIndex, points };
  });
}

export function kernelInputDistributionOption(
  position: KernelInputPosition,
  theme: ChartTheme,
  currentInput?: JsonValue,
): EChartsOption {
  const categorical = position.projection === 'categorical';
  const oneDimensional = position.projection === 'feature_1d';
  const densityByBackend = new Map(
    oneDimensional
      ? oneDimensionalDensity(position).map((density) => [density.backendIndex, density.points])
      : [],
  );
  const scatterSeries = position.selection.map((selection, index) => ({
    name: safeChartText(selection.backendName),
    type: 'scatter' as const,
    data: position.points
      .filter((point) => point.backendIndex === selection.backendIndex)
      .map((point) => [point.x, point.y, point.count]),
    symbolSize: (value: unknown) => {
      const coordinates = Array.isArray(value) ? value : [];
      return pointSize(Number(coordinates[2] ?? 1));
    },
    itemStyle: {
      color: theme.palette[index % theme.palette.length],
      opacity: 0.72,
    },
    emphasis: { focus: 'series' as const, scale: 1.35 },
    clip: !oneDimensional,
    z: 3,
  }));
  const densitySeries = oneDimensional
    ? position.selection.map((selection, index) => ({
        name: safeChartText(selection.backendName),
        type: 'line' as const,
        data: densityByBackend.get(selection.backendIndex) ?? [],
        showSymbol: false,
        smooth: 0.28,
        lineStyle: {
          color: theme.palette[index % theme.palette.length],
          width: 2,
          opacity: 0.9,
        },
        emphasis: { focus: 'series' as const },
        z: 2,
      }))
    : [];
  const current = currentInput === undefined ? null : currentProjection(position, currentInput);
  const currentSeries =
    current === null
      ? []
      : [
          {
            name: 'Current operation',
            type: 'scatter' as const,
            data: [[current[0], current[1]]],
            symbol: 'diamond',
            symbolSize: 18,
            itemStyle: {
              color: theme.palette[1],
              borderColor: theme.bg,
              borderWidth: 2,
            },
            clip: false,
            z: 6,
          },
        ];
  return {
    animationDuration: 280,
    textStyle: { fontFamily: theme.font, color: theme.text },
    color: position.selection.map((_, index) => theme.palette[index % theme.palette.length]),
    grid: chartGrid({ left: categorical ? 16 : 58, right: 18, top: 40, bottom: 42 }),
    legend: {
      top: 0,
      right: 0,
      type: 'scroll',
      textStyle: { color: theme.sub, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 7,
    },
    tooltip: richTextTooltip(theme, 'item', {
      formatter: (params: unknown) => {
        const point = params as { seriesName?: string; seriesType?: string; value?: unknown };
        const value = Array.isArray(point.value) ? point.value : [];
        if (point.seriesName === 'Current operation') {
          const coordinates = categorical
            ? []
            : oneDimensional
              ? [`${position.axisLabels[0]}: ${Number(value[0]).toLocaleString()}`]
              : [
                  `${position.axisLabels[0]}: ${Number(value[0]).toLocaleString()}`,
                  `${position.axisLabels[1]}: ${Number(value[1]).toLocaleString()}`,
                ];
          return tooltipLines(['Current operation', ...coordinates]);
        }
        if (point.seriesType === 'line') {
          return tooltipLines([
            point.seriesName ?? 'backend',
            `${position.axisLabels[0]}: ${Number(value[0]).toLocaleString()}`,
            `probability density: ${Number(value[1]).toPrecision(4)}`,
          ]);
        }
        const coordinates = categorical
          ? []
          : oneDimensional
            ? [`${position.axisLabels[0]}: ${Number(value[0]).toLocaleString()}`]
            : [
                `${position.axisLabels[0]}: ${Number(value[0]).toLocaleString()}`,
                `${position.axisLabels[1]}: ${Number(value[1]).toLocaleString()}`,
              ];
        return tooltipLines([
          point.seriesName ?? 'backend',
          ...coordinates,
          `sampled slots: ${Number(value[2]).toLocaleString()}`,
        ]);
      },
    }),
    xAxis: {
      type: 'value',
      name: categorical ? undefined : safeChartText(position.axisLabels[0]),
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: theme.sub, fontSize: 10 },
      axisLine: categorical ? { show: false } : chartAxisLine(theme),
      axisTick: { show: !categorical },
      axisLabel: { show: !categorical, color: theme.sub, fontSize: 10 },
      splitLine: { show: false },
      min: categorical ? -1 : undefined,
      max: categorical ? 1 : undefined,
    },
    yAxis: {
      ...chartValueAxis(theme),
      name: oneDimensional
        ? 'Probability density'
        : categorical
          ? undefined
          : safeChartText(position.axisLabels[1]),
      nameTextStyle: { color: theme.sub, fontSize: 10 },
      axisLine: categorical ? { show: false } : chartAxisLine(theme),
      axisTick: { show: !categorical },
      axisLabel: { show: !categorical, color: theme.sub, fontSize: 10 },
      splitLine: { show: !categorical },
      min: categorical || oneDimensional ? 0 : undefined,
      max: categorical ? 1 : undefined,
    },
    series: [...scatterSeries, ...densitySeries, ...currentSeries],
  };
}
