import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { Box, ButtonBase, IconButton, Skeleton, Stack, Typography } from '@mui/material';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import type { EChartsOption } from 'echarts';
import { useEffect, useMemo, useState } from 'react';

import {
  getManagedJobResource,
  type ManagedJobResource,
} from '../../application/managedJobRepository';
import {
  useHardwareGpuQuery,
  useKernelMeasurementQueries,
  useKernelProfileQueries,
} from '../../application/queries';
import type {
  KernelMeasurementDescriptor,
  KernelMeasurementSummary,
  KernelProfileCurve,
  KernelProfileRow,
} from '../../domain/offlineResource';
import EChart from '../../components/EChart';
import { useOpenChartFocus, type ChartFocusPayload } from '../../components/ChartFocusContext';
import SurfaceCard from '../../components/SurfaceCard';
import { tokens } from '../../theme';
import { PredictionPage } from '../prediction';

function locationIdentity(): {
  workspaceId: string | null;
  resourceId: string | null;
  analyzerResourceId: string | null;
  jobKind: ManagedJobResource['jobKind'] | null;
} {
  const query = new URLSearchParams(window.location.hash.split('?', 2)[1] ?? '');
  const workspaceId = query.get('workspace');
  const resourceId = query.get('resource');
  const analyzerResourceId = query.get('analyzer');
  const kind = query.get('kind');
  const jobKind =
    kind === 'kernel_profile' || kind === 'kernel_measure' || kind === 'timing_predict'
      ? kind
      : null;
  return { workspaceId, resourceId, analyzerResourceId, jobKind };
}

const JOB_LABELS: Record<ManagedJobResource['jobKind'], string> = {
  timing_predict: 'Timing prediction',
  kernel_profile: 'Kernel profile',
  kernel_measure: 'Kernel measurement',
};

function valueLabel(value: unknown): string {
  if (typeof value === 'number')
    return Number.isInteger(value) ? String(value) : value.toPrecision(4);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function compactEntries(values: Record<string, unknown>) {
  return Object.entries(values).filter(([, value]) => value !== null && value !== undefined);
}

function MetadataTags({ values }: { values: Record<string, unknown> }) {
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
              fontFamily: tokens.mono,
              fontSize: 10.5,
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
        textStyle: { color: tokens.sub, fontSize: 9, fontFamily: tokens.mono },
      },
      tooltip: { trigger: 'axis', confine: true },
      xAxis: {
        type: 'category',
        name: xAxis.key,
        nameLocation: 'middle',
        nameGap: 34,
        data: xAxis.values.map(valueLabel),
        axisLabel: { color: tokens.sub, fontSize: 11 },
        nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
      },
      yAxis: {
        type: 'value',
        name: unit,
        nameLocation: 'middle',
        nameGap: 50,
        axisLabel: { color: tokens.sub, fontSize: 11 },
        nameTextStyle: { color: tokens.sub2, fontSize: 10 },
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
      axisLabel: { color: tokens.sub, fontSize: 11 },
      nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
    },
    yAxis: {
      type: 'category',
      name: yAxis.key,
      nameLocation: 'middle',
      nameGap: 52,
      data: yAxis.values.map(valueLabel),
      axisLabel: { color: tokens.sub, fontSize: 11 },
      nameTextStyle: { color: tokens.ink, fontSize: 12, fontWeight: 600 },
    },
    visualMap: {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
      calculable: false,
      orient: 'vertical',
      right: 4,
      top: 'middle',
      textStyle: { color: tokens.sub, fontSize: 9 },
      inRange: { color: ['#e6eee9', '#9dbfb4', '#1f6f6b'] },
    },
    series: [{ type: 'heatmap', data, itemStyle: { borderColor: '#f5f0e7', borderWidth: 2 } }],
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
              fontFamily: tokens.mono,
              fontSize: 8.5,
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
              fontFamily: tokens.mono,
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

function MetricTile({ curve }: { curve: KernelProfileCurve }) {
  const openFocus = useOpenChartFocus();
  const groups = useMemo(() => facetGroups(curve), [curve]);
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
    <SurfaceCard
      accent={accent}
      sx={{
        p: '14px 16px 12px',
        position: 'relative',
        transition: `box-shadow .4s ${tokens.ease}, border-color .3s ${tokens.ease}`,
        '&:hover': { borderColor: '#d8cfb8', boxShadow: tokens.shadowLift },
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
          '&:hover': { color: '#fff', background: accent },
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
          sx={{ fontFamily: tokens.mono, fontSize: 9, color: tokens.sub, whiteSpace: 'nowrap' }}
        >
          {subtitle}
        </Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: groups.length > 1 ? '1fr' : '1fr',
          gap: 1,
        }}
      >
        {groups.map(([facet, rows]) => (
          <Box key={facet || 'main'} data-testid={`${metric}-facet${facet ? `-${facet}` : ''}`}>
            {facet && (
              <Typography
                sx={{ pt: 0.9, pb: 0.3, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}
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
    </SurfaceCard>
  );
}

function KernelCurve({
  curve,
  descriptor,
}: {
  curve: KernelProfileCurve;
  descriptor?: Record<string, unknown>;
}) {
  const [xAxis] = curve.axes;
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
        <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9.5 }}>
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
        {curve.series.map((series) => (
          <MetricTile key={series.metric} curve={{ ...curve, series: [series] }} />
        ))}
      </Box>
      {curve.series.length === 0 && (
        <Typography sx={{ p: 1, color: tokens.sub }}>No metrics in this curve.</Typography>
      )}
    </Stack>
  );
}

function PlotGallery({ descriptor }: { descriptor: KernelMeasurementDescriptor }) {
  if (!descriptor.plotUrls.length) return null;
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 1 }}
    >
      {descriptor.plotUrls.map((url) => (
        <Box
          key={url}
          component="figure"
          sx={{ m: 0, border: `1px solid ${tokens.hair}`, borderRadius: 1.1, overflow: 'hidden' }}
        >
          <Box
            component="img"
            src={url}
            alt={new URL(url).pathname.split('/').at(-1) ?? 'Kernel measurement plot'}
            loading="lazy"
            sx={{ display: 'block', width: '100%', background: '#faf7f0' }}
          />
          <Typography
            component="figcaption"
            sx={{ px: 1, py: 0.7, color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
          >
            {new URL(url).pathname.split('/').at(-1)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function MeasurementSummary({ summary }: { summary: KernelMeasurementSummary }) {
  const runtimeEntries = Object.entries(summary.runtimeMs);
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 1 }}
    >
      {runtimeEntries.map(([label, value]) => (
        <SurfaceCard
          key={label}
          accent={label === 'median' ? tokens.teal : tokens.gold}
          sx={{ p: 1.4 }}
        >
          <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}>
            {label}
          </Typography>
          <Typography
            sx={{ color: tokens.ink, fontFamily: tokens.serif, fontSize: 25, fontWeight: 650 }}
          >
            {value.toPrecision(4)} ms
          </Typography>
        </SurfaceCard>
      ))}
    </Box>
  );
}

export default function JobResultPage() {
  const identity = locationIdentity();
  const workspaceId = identity?.workspaceId;
  const resourceId = identity?.resourceId;
  const [resource, setResource] = useState<ManagedJobResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceId || !resourceId) return;
    let active = true;
    void getManagedJobResource(workspaceId, resourceId)
      .then((result) => {
        if (active) setResource(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [resourceId, workspaceId]);

  const jobKind = identity.jobKind ?? resource?.jobKind ?? null;
  const analyzerResourceId = identity.analyzerResourceId ?? resource?.analyzerResourceId ?? null;
  const profile = useKernelProfileQueries(jobKind === 'kernel_profile' ? analyzerResourceId : null);
  const measurement = useKernelMeasurementQueries(
    jobKind === 'kernel_measure' ? analyzerResourceId : null,
  );
  const measurementGpuName =
    measurement.descriptor.data?.gpu.observedName ??
    measurement.descriptor.data?.gpu.cacheKey ??
    null;
  const hardware = useHardwareGpuQuery(measurementGpuName);

  if ((!workspaceId || !resourceId) && (!identity.analyzerResourceId || !identity.jobKind)) {
    return <Typography>Missing Analyzer resource identity.</Typography>;
  }
  if (error) {
    return (
      <Stack direction="row" sx={{ p: 2, gap: 1, color: '#9a4538' }}>
        <ErrorOutlineRounded />
        <Typography>{error}</Typography>
      </Stack>
    );
  }
  if (workspaceId && resourceId && !resource) {
    return (
      <Stack sx={{ gap: 1.2 }}>
        <Skeleton variant="rounded" height={74} />
        <Skeleton variant="rounded" height={360} />
      </Stack>
    );
  }
  return (
    <Stack sx={{ gap: 1.4, p: { xs: 1.2, md: 2 } }}>
      <SurfaceCard
        sx={{
          p: 1.5,
          background: 'rgba(31,111,107,.035)',
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ gap: 1.1 }}>
          <CheckCircleOutlineRounded sx={{ color: tokens.teal, fontSize: 18 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 15, fontWeight: 700 }}>
              {jobKind ? JOB_LABELS[jobKind] : 'Analyzer result'}
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9 }}>
              {analyzerResourceId ?? 'pending identity'}
            </Typography>
          </Box>
          <ButtonBase
            onClick={() => window.history.back()}
            sx={{ ml: 'auto', px: 0.9, py: 0.5, gap: 0.45, color: tokens.sub, fontSize: 10 }}
          >
            <ArrowBackRounded sx={{ fontSize: 14 }} /> Back
          </ButtonBase>
        </Stack>
      </SurfaceCard>

      {jobKind === 'timing_predict' ? (
        analyzerResourceId ? (
          <PredictionPage predictionId={analyzerResourceId} />
        ) : (
          <SurfaceCard role="alert" accent={tokens.terra} sx={{ p: 2 }}>
            <Typography sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 11 }}>
              Timing prediction has no Analyzer resource identity.
            </Typography>
          </SurfaceCard>
        )
      ) : jobKind === 'kernel_profile' ? (
        profile.descriptor.data && profile.curve.data ? (
          <KernelCurve
            curve={profile.curve.data}
            descriptor={{
              backend: profile.descriptor.data.kernel.backend,
              family: profile.descriptor.data.kernel.metricFamily,
              gpu:
                profile.descriptor.data.gpu?.observedName ?? profile.descriptor.data.gpu?.cacheKey,
              profile_action:
                profile.descriptor.data.mode === 'jit-fill'
                  ? 'filled missing points'
                  : profile.descriptor.data.mode === 'force-refresh'
                    ? 'refreshed all points'
                    : profile.descriptor.data.mode,
              source: profile.descriptor.data.legacy ? 'legacy profile' : undefined,
              data_source:
                profile.descriptor.data.provenanceSource === 'measurement'
                  ? 'measured now'
                  : profile.descriptor.data.provenanceSource === 'cache_key'
                    ? 'profile cache'
                    : undefined,
              gpu_status:
                profile.descriptor.data.legacy && profile.descriptor.data.gpu === null
                  ? 'not recorded'
                  : undefined,
            }}
          />
        ) : (
          <Typography sx={{ p: 2, color: profile.curve.isError ? tokens.terra : tokens.sub }}>
            {profile.curve.isError
              ? 'Kernel profile could not be loaded from Analyzer.'
              : 'Kernel profile is pending in Analyzer.'}
          </Typography>
        )
      ) : jobKind === 'kernel_measure' ? (
        measurement.descriptor.data && measurement.summary.data ? (
          <Stack sx={{ gap: 1.4 }}>
            <MetadataTags
              values={{
                kernel: measurement.descriptor.data.kernel.kind,
                backend: measurement.descriptor.data.kernel.backend,
                gpu:
                  measurement.descriptor.data.gpu.observedName ??
                  measurement.descriptor.data.gpu.cacheKey,
                duration_s: measurement.descriptor.data.durationSeconds,
                hbm_gbps: hardware.data?.hbmBandwidthGbps,
                interconnect_one_way_gbps: hardware.data?.interconnect?.oneWayGbps,
                ...measurement.descriptor.data.shape,
              }}
            />
            <MeasurementSummary summary={measurement.summary.data} />
            <PlotGallery descriptor={measurement.descriptor.data} />
          </Stack>
        ) : (
          <Typography sx={{ p: 2, color: measurement.summary.isError ? tokens.terra : tokens.sub }}>
            {measurement.summary.isError
              ? 'Kernel measurement could not be loaded from Analyzer.'
              : 'Kernel measurement is pending in Analyzer.'}
          </Typography>
        )
      ) : null}
    </Stack>
  );
}
