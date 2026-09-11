import { chartFont } from '../../ui/theme/metrics';
import { tokens, colors } from '../../ui/theme';
import type { EChartsOption } from 'echarts';

import {
  CHART_THEME,
  chartAxisLine,
  chartGrid,
  richTextTooltip,
  safeChartText,
  tooltipLines,
} from '../../ui/charts/platform';
import { KERNEL_TIME_EPSILON_MS } from '../../artifacts/schema/kernelTimeShare';
import type { WorkerComposition } from './composition';

export function workerKernelPositionOption(composition: WorkerComposition): EChartsOption {
  const familyRow = composition;
  const familyChunks = composition.families.map((family) => ({
    name: safeChartText(family.label),
    dimension: 'kernel family',
    timeMs: family.kernelTimeMs,
    sharePct:
      familyRow.kernelTimeMs > KERNEL_TIME_EPSILON_MS
        ? (family.kernelTimeMs / familyRow.kernelTimeMs) * 100
        : 0,
    color: family.color,
    data: [
      familyRow.kernelTimeMs > KERNEL_TIME_EPSILON_MS
        ? (family.kernelTimeMs / familyRow.kernelTimeMs) * 100
        : 0,
      0,
    ],
  }));
  const positionChunks = composition.slices.map((position) => ({
    name: safeChartText(position.position),
    dimension: 'kernel position',
    timeMs: position.kernelTimeMs,
    sharePct: position.sharePct,
    color: position.color,
    data: [0, position.sharePct],
  }));
  const chunks = [...familyChunks, ...positionChunks];

  return {
    textStyle: { fontFamily: CHART_THEME.font, color: CHART_THEME.text },
    grid: chartGrid({ left: 150, right: 22, top: 18, bottom: 28 }),
    tooltip: richTextTooltip(CHART_THEME, 'item', {
      formatter: (params: unknown) => {
        const item = params as { seriesIndex?: number; value?: number };
        const chunk = chunks[item.seriesIndex ?? -1];
        return chunk && Number(item.value ?? 0) > 0
          ? tooltipLines([
              chunk.name,
              chunk.dimension,
              `${chunk.sharePct.toFixed(2)}%`,
              `${chunk.timeMs.toLocaleString('en-US', { maximumFractionDigits: 2 })} ms`,
            ])
          : '';
      },
    }),
    xAxis: {
      type: 'value',
      max: 100,
      name: '% of worker CostTree-root kernel time',
      nameTextStyle: { color: CHART_THEME.sub, fontSize: chartFont(10) },
      axisLine: chartAxisLine(CHART_THEME),
      axisLabel: { color: CHART_THEME.sub, fontSize: chartFont(11), formatter: '{value}%' },
      splitLine: { lineStyle: { color: CHART_THEME.split, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: ['by kernel family', 'by kernel position'],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: CHART_THEME.text,
        fontSize: chartFont(12),
        fontFamily: CHART_THEME.font,
        fontWeight: 600,
      },
    },
    series: chunks.map((chunk) => ({
      name: chunk.name,
      type: 'bar' as const,
      stack: 'worker-kernel-time',
      data: chunk.data,
      barMaxWidth: 38,
      itemStyle: { color: chunk.color, borderColor: tokens.tile, borderWidth: 0.7 },
      label: {
        show: chunk.sharePct >= 5,
        position: 'inside' as const,
        // A series contributes to only one row. Suppress its zero-valued
        // sibling point so a position label cannot leak onto the family bar.
        formatter: (params: { value?: unknown }) =>
          Number(params.value ?? 0) > 0
            ? `${safeChartText(chunk.name.split('.').pop() ?? chunk.name)}\n${chunk.sharePct.toFixed(1)}%`
            : '',
        color: colors.tooltipText,
        fontSize: chartFont(9),
      },
    })),
  };
}
