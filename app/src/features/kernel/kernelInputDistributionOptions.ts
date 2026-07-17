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

function pointSize(count: number): number {
  return Math.min(17, 6 + Math.log2(Math.max(1, count)) * 1.6);
}

const DENSITY_GRID_POINTS = 96;
const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

interface DensitySeries {
  readonly backendIndex: number;
  readonly points: [number, number][];
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
    series: [...scatterSeries, ...densitySeries],
  };
}
