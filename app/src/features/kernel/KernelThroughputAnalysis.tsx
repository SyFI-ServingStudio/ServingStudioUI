import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useState } from 'react';
import type { EChartsOption, LineSeriesOption, ScatterSeriesOption } from 'echarts';

import EChart from '../../components/EChart';
import type { LeafNode } from '../../domain/cost-tree';
import type { JsonValue } from '../../domain/cost-tree';
import type {
  KernelThroughputAnalysis as Analysis,
  KernelThroughputPoint,
} from '../../domain/kernelThroughputAnalysis';
import { tokens } from '../../theme';

type ThroughputMetric = 'tflops' | 'gbps';

const COMPUTE_BOUND_FLOPS_PER_BYTE = 150;

function nearest(axis: readonly number[], target: unknown): number {
  if (typeof target !== 'number' || !Number.isFinite(target)) return axis[Math.floor(axis.length / 2)];
  return axis.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  );
}

function automaticMetric(
  points: readonly KernelThroughputPoint[],
  node: LeafNode,
): ThroughputMetric | null {
  const hasFlops = points.some((point) => point.flops > 0);
  const hasBytes = points.some((point) => point.bytes > 0);
  if (!hasFlops) return hasBytes ? 'gbps' : null;
  if (!hasBytes) return 'tflops';

  // Prefer the exact operation's arithmetic intensity because that is the
  // highlighted point. Grid totals are only a fallback for older CostTrees
  // whose exact work counters were not recorded.
  const hasExactWork = node.stats.flops !== null && node.stats.bytes !== null;
  const flops = hasExactWork
    ? node.stats.flops!
    : points.reduce((total, point) => total + point.flops, 0);
  const bytes = hasExactWork
    ? node.stats.bytes!
    : points.reduce((total, point) => total + point.bytes, 0);
  return flops >= bytes * COMPUTE_BOUND_FLOPS_PER_BYTE ? 'tflops' : 'gbps';
}

function metric(kind: ThroughputMetric | null, node: LeafNode) {
  if (kind === 'tflops') {
    return {
      label: 'TFLOP/s',
      value: (point: KernelThroughputPoint) =>
        point.timeMs > 0 ? point.flops / point.timeMs / 1e9 : null,
      exact: node.stats.tflops,
    };
  }
  if (kind === 'gbps') {
    return {
      label: 'GB/s',
      value: (point: KernelThroughputPoint) =>
        point.timeMs > 0 ? point.bytes / point.timeMs / 1e6 : null,
      exact: node.stats.gbps,
    };
  }
  return {
    label: 'ms',
    value: (point: KernelThroughputPoint) => point.timeMs,
    exact: node.base,
  };
}

export default function KernelThroughputAnalysis({
  analysis,
  node,
}: {
  analysis: Analysis;
  node: LeafNode;
}) {
  const xField = analysis.inputFields[0];
  const exact: Readonly<Record<string, JsonValue>> =
    typeof analysis.exactInput === 'object' &&
    analysis.exactInput !== null &&
    !Array.isArray(analysis.exactInput)
      ? (analysis.exactInput as Readonly<Record<string, JsonValue>>)
      : {};
  const held = analysis.inputFields.slice(1).map((field, index) => ({
    field,
    value: nearest(analysis.gridAxes[index + 1], exact[field]),
  }));
  const slice = analysis.points.filter((point) =>
    held.every(({ field, value }) => point.input[field] === value),
  );
  const rankedShapes = analysis.inputFields.length === 2;
  const plottedPoints = rankedShapes ? analysis.points : slice;
  const suggestedMetric = automaticMetric(plottedPoints, node);
  const availableMetrics = {
    tflops: plottedPoints.some((point) => point.flops > 0),
    gbps: plottedPoints.some((point) => point.bytes > 0),
  };
  const [selectedMetric, setSelectedMetric] = useState<ThroughputMetric | null>(suggestedMetric);
  const activeMetric =
    selectedMetric !== null && availableMetrics[selectedMetric]
      ? selectedMetric
      : suggestedMetric;
  const rate = metric(activeMetric, node);
  const series: (LineSeriesOption | ScatterSeriesOption)[] = [];
  let xAxis: EChartsOption['xAxis'];

  if (rankedShapes) {
    const ranked = plottedPoints
      .map((point) => ({ point, value: rate.value(point) }))
      .filter(
        (measurement): measurement is { point: KernelThroughputPoint; value: number } =>
          measurement.value !== null,
      )
      .sort((left, right) => left.value - right.value);
    const categories = ranked.map(({ point }) =>
      analysis.inputFields.map((field) => `${field}=${point.input[field]}`).join(', '),
    );
    const lineData: (number | null)[] = ranked.map(({ value }) => value);
    const currentCategory = 'Current operation';

    if (rate.exact !== null) {
      const greaterIndex = ranked.findIndex(({ value }) => value > rate.exact!);
      const insertionIndex = greaterIndex === -1 ? ranked.length : greaterIndex;
      categories.splice(insertionIndex, 0, currentCategory);
      lineData.splice(insertionIndex, 0, null);
    }

    series.push({
      name: 'Rust cache',
      type: 'line',
      showSymbol: true,
      symbolSize: 4,
      connectNulls: true,
      data: lineData,
      lineStyle: { width: 1.5, color: tokens.teal },
      itemStyle: { color: tokens.teal },
    });
    if (rate.exact !== null) {
      series.push({
        name: 'Current operation',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 18,
        z: 5,
        data: [[currentCategory, rate.exact]],
        itemStyle: {
          color: tokens.terra,
          borderColor: tokens.paper,
          borderWidth: 2,
        },
      });
    }
    xAxis = {
      type: 'category',
      data: categories,
      name: 'input shapes · sorted throughput',
      nameLocation: 'middle',
      nameGap: 27,
      axisLabel: { show: false },
    };
  } else {
    const lineData = plottedPoints
      .map((point) => [point.input[xField], rate.value(point)])
      .filter((point): point is [number, number] => point[1] !== null)
      .sort((left, right) => left[0] - right[0]);
    const exactX = exact[xField];
    series.push({
      name: 'Rust cache',
      type: 'line',
      showSymbol: true,
      symbolSize: 4,
      data: lineData,
      lineStyle: { width: 1.5, color: tokens.teal },
      itemStyle: { color: tokens.teal },
    });
    if (typeof exactX === 'number' && rate.exact !== null) {
      series.push({
        name: 'Current operation',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 18,
        z: 5,
        data: [[exactX, rate.exact]],
        itemStyle: {
          color: tokens.terra,
          borderColor: tokens.paper,
          borderWidth: 2,
        },
      });
    }
    xAxis = { type: 'value', name: xField, nameLocation: 'middle', nameGap: 27 };
  }
  const option: EChartsOption = {
    animation: false,
    grid: { left: 56, right: 16, top: 28, bottom: 42 },
    legend: { top: 0, right: 0, textStyle: { fontSize: 9 } },
    tooltip: { trigger: 'axis' },
    xAxis,
    yAxis: { type: 'value', name: rate.label, nameLocation: 'middle', nameGap: 42 },
    series,
  };
  const sliceLabel = held.map(({ field, value }) => `${field}=${value}`).join(', ');

  return (
    <>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        sx={{ mt: 0.35 }}
      >
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 9, color: tokens.sub }}>
          {rankedShapes
            ? `Rust cache grid shapes ranked by ${rate.label}`
            : `Rust cache evaluation across ${xField}${
                sliceLabel.length > 0 ? ` · slice ${sliceLabel}` : ''
              }`}
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={activeMetric}
          onChange={(_, value: ThroughputMetric | null) => {
            if (value !== null) setSelectedMetric(value);
          }}
          aria-label="Throughput metric"
          sx={{
            flexShrink: 0,
            '& .MuiToggleButton-root': {
              px: 0.8,
              py: 0.15,
              fontFamily: tokens.mono,
              fontSize: 9,
              lineHeight: 1.45,
              color: tokens.sub,
              borderColor: tokens.hair,
              '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
            },
          }}
        >
          <ToggleButton value="tflops" disabled={!availableMetrics.tflops}>
            TFLOP/s
          </ToggleButton>
          <ToggleButton value="gbps" disabled={!availableMetrics.gbps}>
            GB/s
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Box data-testid="kernel-throughput-analysis" sx={{ mt: 0.75, height: 230 }}>
        <EChart
          option={option}
          ariaLabel={
            rankedShapes
              ? `Kernel throughput analysis of two-dimensional input shapes ranked by ${rate.label}`
              : `Kernel throughput analysis over ${xField} in ${rate.label}`
          }
        />
      </Box>
    </>
  );
}
