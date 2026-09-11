import { Box, IconButton, Stack, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import type { EChartsOption } from 'echarts';
import { memo, useMemo } from 'react';
import type {
  KernelMeasurementDescriptor,
  KernelMeasurementSummary,
  KernelProfileCurve,
  KernelProfileRow,
} from '../../artifacts/schema/offlineResource';
import EChart from '../../ui/controls/EChart';
import { EvidenceSurfaceCard } from '../../ui/controls/EvidenceSurfaceCard';
import { useOpenChartFocus, type ChartFocusPayload } from '../../ui/controls/ChartFocusContext';
import { tokens, colors } from '../../ui/theme';

function valueLabel(value: unknown): string {
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toPrecision(4);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function compactEntries(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
}

export function MetadataTags({ values }: { values: Record<string, unknown> }) {
  const entries = compactEntries(values);
  if (entries.length === 0) return null;
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: 0.7 }}>
      {entries.map(([key, value]) => {
        const scalar = Array.isArray(value) ? value.map(valueLabel).join(', ') : valueLabel(value);
        return (
          <Box
            key={key}
            component="span"
            title={`${key}: ${scalar}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 0.5,
              px: 1,
              py: 0.5,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.9,
              color: tokens.ink,
              background: tokens.tile2,
              fontFamily: tokens.body,
              fontSize: 12,
              lineHeight: 1.3,
            }}
          >
            <Box component="span" sx={{ color: tokens.sub2, fontWeight: 600 }}>
              {key}
            </Box>
            <Box component="span" sx={{ color: tokens.ink, fontWeight: 700 }}>
              {scalar}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function facetGroups(curve: KernelProfileCurve): readonly [string, readonly KernelProfileRow[]][] {
  const facetKeys = curve.layout.facets;
  if (!facetKeys.length) return [['', curve.rows]];
  const groups = new Map<string, KernelProfileRow[]>();
  curve.rows.forEach((row) => {
    const key = facetKeys
      .map((facet) => `${facet}=${valueLabel(row.coordinates[facet])}`)
      .join('  ');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  return [...groups.entries()];
}

function metricValue(row: KernelProfileRow, metric: string): number | null {
  const value = row.metrics?.[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hardwareLimit(row: KernelProfileRow, metric: string): number | null {
  const candidate = row.hardware?.[`${metric}_limit`];
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const limit = (candidate as { limit?: unknown }).limit;
  return typeof limit === 'number' && Number.isFinite(limit) ? limit : null;
}

function chartOption(
  curve: KernelProfileCurve,
  rows: readonly KernelProfileRow[],
  metric: string,
  unit: string,
): EChartsOption {
  const [xAxis, yAxis] = curve.axes;
  if (!xAxis) {
    return {
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
      graphic: {
        type: 'text',
        left: 'center',
        top: 'middle',
        style: {
          text: `${metricValue(rows[0], metric) ?? 'N/A'} ${unit}`,
          fill: tokens.ink,
          font: `600 28px ${tokens.mono}`,
        },
      },
    };
  }
  if (!yAxis) {
    const measured = xAxis.values.map((xValue) => {
      const row = rows.find((candidate) => candidate.coordinates[xAxis.key] === xValue);
      return row ? metricValue(row, metric) : null;
    });
    const limits = xAxis.values.map((xValue) => {
      const row = rows.find((candidate) => candidate.coordinates[xAxis.key] === xValue);
      return row ? hardwareLimit(row, metric) : null;
    });
    return {
      grid: { left: 92, right: 24, top: 26, bottom: 54 },
      legend: {
        right: 6,
        top: 0,
        textStyle: { color: tokens.sub, fontSize: 12, fontFamily: tokens.body },
      },
      tooltip: { trigger: 'axis', confine: true },
      xAxis: {
        type: 'category',
        name: xAxis.key,
        nameLocation: 'middle',
        nameGap: 34,
        data: xAxis.values.map(valueLabel),
        axisLabel: { color: tokens.sub, fontSize: 12 },
        nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
      },
      yAxis: {
        type: 'value',
        name: unit,
        nameLocation: 'middle',
        nameGap: 50,
        axisLabel: { color: tokens.sub, fontSize: 12 },
        nameTextStyle: { color: tokens.sub2, fontSize: 12 },
        splitLine: { lineStyle: { color: tokens.hair } },
      },
      series: [
        {
          name: 'measured',
          type: 'line',
          smooth: false,
          symbolSize: 7,
          lineStyle: { width: 2, color: tokens.teal },
          itemStyle: { color: tokens.teal },
          data: measured,
        },
        ...(limits.some((value) => value !== null)
          ? [
              {
                name: 'catalog peak',
                type: 'line' as const,
                symbol: 'none',
                lineStyle: { width: 1.5, type: 'dashed' as const, color: tokens.gold },
                data: limits,
              },
            ]
          : []),
      ],
    };
  }
  const data = rows.flatMap((row) => {
    const xIndex = xAxis.values.findIndex((value) => value === row.coordinates[xAxis.key]);
    const yIndex = yAxis.values.findIndex((value) => value === row.coordinates[yAxis.key]);
    const value = metricValue(row, metric);
    return xIndex >= 0 && yIndex >= 0 && value !== null ? [[xIndex, yIndex, value]] : [];
  });
  const values = data.map((item) => item[2]);
  return {
    grid: { left: 78, right: 86, top: 24, bottom: 58 },
    tooltip: { position: 'top', confine: true },
    xAxis: {
      type: 'category',
      name: xAxis.key,
      nameLocation: 'middle',
      nameGap: 36,
      data: xAxis.values.map(valueLabel),
      axisLabel: { color: tokens.sub, fontSize: 12 },
      nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
    },
    yAxis: {
      type: 'category',
      name: yAxis.key,
      nameLocation: 'middle',
      nameGap: 52,
      data: yAxis.values.map(valueLabel),
      axisLabel: { color: tokens.sub, fontSize: 12 },
      nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
    },
    visualMap: {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      calculable: false,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      textStyle: { color: tokens.sub, fontSize: 12 },
      inRange: { color: [colors.heatLow, colors.heatMiddle, tokens.teal] },
    },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: tokens.tile, borderWidth: 2 } }],
  };
}

const METRIC_ACCENTS: Record<string, string> = {
  time_ms: tokens.teal,
  tflops: tokens.violet,
  memory_bandwidth_gbps: tokens.olive,
  energy_j: tokens.terra,
};

const METRIC_LABELS: Record<string, string> = {
  time_ms: 'Latency',
  tflops: 'Throughput',
  memory_bandwidth_gbps: 'Bandwidth',
  energy_j: 'Energy',
};

function metricAccent(metric: string): string {
  return METRIC_ACCENTS[metric] ?? tokens.gold;
}

function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric;
}

const MetricTileCharts = memo(function MetricTileCharts({
  curve,
  metric,
  unit,
}: {
  curve: KernelProfileCurve;
  metric: string;
  unit: string;
}) {
  const groups = useMemo(() => facetGroups(curve), [curve]);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1 }}>
      {groups.map(([facet, rows]) => (
        <Box key={facet || 'main'} data-testid={`${metric}-facet${facet ? `-${facet}` : ''}`}>
          {facet && (
            <Typography
              sx={{ pt: 0.9, pb: 0.3, color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}
            >
              {facet}
            </Typography>
          )}
          <EChart
            option={chartOption(curve, rows, metric, unit)}
            ariaLabel={`${metricLabel(metric)}${facet ? `, ${facet}` : ''} · ${curve.table}`}
            style={{ height: 216, width: '100%' }}
          />
        </Box>
      ))}
    </Box>
  );
});

function ParamStatline({ values }: { values: Record<string, unknown> }) {
  const entries = compactEntries(values);
  if (entries.length === 0) return null;
  return (
    <Box
      aria-label="Fixed kernel parameters"
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        overflow: 'hidden',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 1.1,
        background: tokens.tile2,
      }}
    >
      {entries.map(([key, value], index) => (
        <Box
          key={key}
          sx={[
            { px: 1.7, py: 0.85, minWidth: 0 },
            index > 0 && { borderLeft: `1px solid ${tokens.hair}` },
          ]}
        >
          <Typography
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.18em',
              textTransform: 'uppercase' as const,
              color: tokens.sub,
              lineHeight: 1,
              mb: 0.35,
            }}
          >
            {key.replace(/_/g, ' ')}
          </Typography>
          <Typography
            component="div"
            sx={{
              fontFamily: tokens.body,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.2,
              color: tokens.ink,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-.01em',
            }}
          >
            {Array.isArray(value) ? value.map(valueLabel).join(', ') : valueLabel(value)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export function MetricTile({
  curve,
  selected,
  onSelect,
}: {
  curve: KernelProfileCurve;
  selected: boolean;
  onSelect: (metric: string) => void;
}) {
  const openFocus = useOpenChartFocus();
  const series = curve.series[0];
  const metric = series?.metric ?? '';
  const unit = series?.unit ?? '';
  const [xAxis] = curve.axes;
  const accent = metricAccent(metric);
  const subtitle = `${unit || metric}` + (xAxis ? ` · over ${xAxis.key}` : '');
  const focusPayload: ChartFocusPayload = {
    title: `${metricLabel(metric)} · ${metric}`,
    caption:
      `${curve.backend} / ${curve.metricFamily} · ${curve.table}` +
      (unit ? ` · unit ${unit}` : '') +
      (xAxis ? ` · x ${xAxis.key} = ${xAxis.values.map(valueLabel).join(', ')}` : ''),
    option: chartOption(curve, curve.rows, metric, unit),
  };
  return (
    <EvidenceSurfaceCard
      evidenceId={`kernel-profile:${metric}`}
      selectedForAgent={selected}
      onEvidenceSelect={() => onSelect(metric)}
      accent={accent}
      sx={{
        p: '14px 16px 12px',
        position: 'relative',
        transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
        '&:hover': { borderColor: tokens.hair, boxShadow: tokens.shadowLift },
      }}
    >
      <IconButton
        className="expand"
        aria-label={`Expand ${metricLabel(metric)} chart`}
        size="small"
        onClick={() => openFocus(focusPayload)}
        sx={{
          position: 'absolute',
          top: 12,
          right: 12,
          opacity: 0,
          color: tokens.sub,
          transition: `all .28s ${tokens.ease}`,
          '&:hover': { color: colors.foregroundOnAccent, background: accent },
          '&:focus-visible': {
            opacity: 1,
            color: accent,
            background: tokens.tile2,
            outline: `2px solid ${accent}`,
            outlineOffset: 2,
          },
          zIndex: 3,
        }}
      >
        <OpenInFullIcon sx={{ fontSize: 15 }} />
      </IconButton>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="baseline"
        sx={{ gap: 1, pr: 1 }}
      >
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 700,
            fontSize: 20,
            letterSpacing: '-.01em',
            color: tokens.ink,
          }}
        >
          {metricLabel(metric)}
        </Typography>
        <Typography
          sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub, whiteSpace: 'nowrap' }}
        >
          {subtitle}
        </Typography>
      </Stack>
      <MetricTileCharts curve={curve} metric={metric} unit={unit} />
    </EvidenceSurfaceCard>
  );
}

export function KernelCurve({
  curve,
  descriptor,
  selectedMetric,
  onMetricSelect,
}: {
  curve: KernelProfileCurve;
  descriptor?: Record<string, unknown>;
  selectedMetric: string | null;
  onMetricSelect: (metric: string) => void;
}) {
  const [xAxis] = curve.axes;
  const seriesCurves = useMemo(
    () => curve.series.map((series) => ({ series, curve: { ...curve, series: [series] } })),
    [curve],
  );
  const readyPointCount = curve.rows.filter((row) => row.status === 'ok').length;
  const params = useMemo<Record<string, unknown>>(
    () => ({
      ...(descriptor ?? {}),
      axes:
        curve.axes.length > 0
          ? curve.axes.map((axis) => `${axis.key} · ${axis.values.length} values`).join(' × ')
          : 'scalar',
      points: `${readyPointCount} / ${curve.rows.length} ready`,
      metrics: curve.series.length,
      facets: curve.layout.facets.length ? curve.layout.facets.join(', ') : undefined,
      ...curve.fixedArgs,
    }),
    [curve, descriptor, readyPointCount],
  );
  return (
    <Stack sx={{ gap: 1.4 }}>
      <Box>
        <Typography
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 700,
            fontSize: 21,
            letterSpacing: '-.01em',
            color: tokens.ink,
          }}
        >
          {curve.table}
        </Typography>
        <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
          {curve.backend} / {curve.metricFamily}
          {xAxis ? ` · over ${xAxis.key}` : ' · scalar'}
          {curve.axes.length > 1 ? ` × ${curve.axes[1].key}` : ''}
        </Typography>
      </Box>
      <ParamStatline values={params} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          gap: 1.4,
          alignItems: 'start',
        }}
      >
        {seriesCurves.map(({ series, curve: seriesCurve }) => (
          <MetricTile
            key={series.metric}
            curve={seriesCurve}
            selected={selectedMetric === series.metric}
            onSelect={onMetricSelect}
          />
        ))}
      </Box>
      {curve.series.length === 0 && (
        <Typography sx={{ p: 1, color: tokens.sub }}>No metrics in this curve.</Typography>
      )}
    </Stack>
  );
}

export function PlotGallery({
  descriptor,
  selectedPlot,
  onPlotSelect,
}: {
  descriptor: KernelMeasurementDescriptor;
  selectedPlot: string | null;
  onPlotSelect: (plotName: string) => void;
}) {
  if (!descriptor.plotUrls.length) return null;
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 1 }}
    >
      {descriptor.plotUrls.map((url) => {
        const plotName = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? 'plot');
        return (
          <EvidenceSurfaceCard
            key={url}
            component="figure"
            evidenceId={`kernel-measurement:plot:${plotName}`}
            selectedForAgent={selectedPlot === plotName}
            onEvidenceSelect={() => onPlotSelect(plotName)}
            sx={{
              m: 0,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 1.1,
              overflow: 'hidden',
            }}
          >
            <Box
              component="img"
              src={url}
              alt={plotName}
              loading="lazy"
              sx={{ display: 'block', width: '100%', background: tokens.tile }}
            />
            <Typography
              component="figcaption"
              sx={{ px: 1, py: 0.7, color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}
            >
              {plotName}
            </Typography>
          </EvidenceSurfaceCard>
        );
      })}
    </Box>
  );
}

export function MeasurementSummary({
  summary,
  selectedMetric,
  onMetricSelect,
}: {
  summary: KernelMeasurementSummary;
  selectedMetric: string | null;
  onMetricSelect: (metric: string) => void;
}) {
  const runtimeEntries = Object.entries(summary.runtimeMs);
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, minmax(0,1fr))', md: 'repeat(5, minmax(0,1fr))' },
        gap: 1.5,
      }}
    >
      {runtimeEntries.map(([label, value]) => (
        <EvidenceSurfaceCard
          key={label}
          evidenceId={`kernel-measurement:summary:${label}`}
          selectedForAgent={selectedMetric === label}
          onEvidenceSelect={() => onMetricSelect(label)}
          accent={label === 'median' ? tokens.teal : tokens.gold}
          sx={{ p: 1.4 }}
        >
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
            {label}
          </Typography>
          <Typography
            sx={{
              color: tokens.ink,
              fontFamily: tokens.serif,
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: '-.025em',
            }}
          >
            {value.toPrecision(4)} ms
          </Typography>
        </EvidenceSurfaceCard>
      ))}
    </Box>
  );
}
