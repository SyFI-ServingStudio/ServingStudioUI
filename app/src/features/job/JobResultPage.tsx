import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { useEffect, useMemo, useState } from 'react';

import {
  getManagedJobResource,
  managedJobArtifactUrl,
  type KernelProfileCurve,
  type KernelProfileRow,
  type ManagedJobResource,
} from '../../application/managedJobRepository';
import EChart from '../../components/EChart';
import { tokens } from '../../theme';

function locationIdentity(): { workspaceId: string; resourceId: string } | null {
  const query = new URLSearchParams(window.location.hash.split('?', 2)[1] ?? '');
  const workspaceId = query.get('workspace');
  const resourceId = query.get('resource');
  return workspaceId && resourceId ? { workspaceId, resourceId } : null;
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
  return (
    <Stack direction="row" useFlexGap flexWrap="wrap" sx={{ gap: 0.55 }}>
      {compactEntries(values).map(([key, value]) => (
        <Box
          key={key}
          component="span"
          sx={{
            px: 0.8,
            py: 0.35,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.7,
            color: tokens.sub,
            background: 'rgba(91,82,71,.035)',
            fontFamily: tokens.mono,
            fontSize: 9,
          }}
        >
          <Box component="span" sx={{ color: tokens.sub2 }}>
            {key}
          </Box>{' '}
          {Array.isArray(value) ? value.map(valueLabel).join(', ') : valueLabel(value)}
        </Box>
      ))}
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
    return {
      grid: { left: 68, right: 24, top: 22, bottom: 54 },
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
        axisLabel: { color: tokens.sub, fontSize: 11 },
        nameTextStyle: { color: tokens.sub2, fontSize: 10 },
        splitLine: { lineStyle: { color: tokens.hair } },
      },
      series: [
        {
          type: 'line',
          smooth: false,
          symbolSize: 7,
          lineStyle: { width: 2, color: tokens.teal },
          itemStyle: { color: tokens.teal },
          data: xAxis.values.map((xValue) => {
            const row = rows.find((candidate) => candidate.coordinates[xAxis.key] === xValue);
            return row ? metricValue(row, metric) : null;
          }),
        },
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

function KernelCurve({ curve }: { curve: KernelProfileCurve }) {
  const [metric, setMetric] = useState(curve.series[0]?.metric ?? 'time_ms');
  const selectedSeries = curve.series.find((series) => series.metric === metric) ?? curve.series[0];
  const groups = useMemo(() => facetGroups(curve), [curve]);
  return (
    <Stack sx={{ gap: 1.2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ gap: 2 }}>
        <Box>
          <Typography sx={{ color: tokens.ink, fontSize: 17, fontWeight: 700 }}>
            {curve.table}
          </Typography>
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9.5 }}>
            {curve.backend} / {curve.metricFamily}
          </Typography>
        </Box>
        <Stack
          direction="row"
          useFlexGap
          flexWrap="wrap"
          sx={{ gap: 0.45, justifyContent: 'flex-end' }}
        >
          {curve.series.map((series) => (
            <ButtonBase
              key={series.metric}
              onClick={() => setMetric(series.metric)}
              sx={{
                px: 0.85,
                py: 0.4,
                border: `1px solid ${metric === series.metric ? 'rgba(31,111,107,.42)' : tokens.hair}`,
                borderRadius: 0.7,
                color: metric === series.metric ? tokens.teal : tokens.sub,
                background: metric === series.metric ? 'rgba(31,111,107,.07)' : 'transparent',
                fontFamily: tokens.mono,
                fontSize: 9,
              }}
            >
              {series.metric}
            </ButtonBase>
          ))}
        </Stack>
      </Stack>
      <MetadataTags values={curve.fixedArgs} />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: groups.length > 1 ? 'repeat(auto-fit, minmax(360px, 1fr))' : '1fr',
          gap: 1,
        }}
      >
        {groups.map(([facet, rows]) => (
          <Box
            key={facet || 'main'}
            sx={{ border: `1px solid ${tokens.hair}`, borderRadius: 1.1, background: '#faf7f0' }}
          >
            {facet && (
              <Typography
                sx={{ px: 1.25, pt: 1, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}
              >
                {facet}
              </Typography>
            )}
            <EChart
              option={chartOption(curve, rows, metric, selectedSeries?.unit ?? '')}
              ariaLabel={`${metric}${facet ? `, ${facet}` : ''}`}
              style={{ height: 330, width: '100%' }}
            />
          </Box>
        ))}
      </Box>
    </Stack>
  );
}

function PlotGallery({ resource }: { resource: ManagedJobResource }) {
  const plots = resource.files.filter((path) => /\.(png|jpe?g|webp)$/i.test(path));
  if (!plots.length) return null;
  return (
    <Box
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: 1 }}
    >
      {plots.map((path) => (
        <Box
          key={path}
          component="figure"
          sx={{ m: 0, border: `1px solid ${tokens.hair}`, borderRadius: 1.1, overflow: 'hidden' }}
        >
          <Box
            component="img"
            src={managedJobArtifactUrl(resource.workspaceId, resource.resourceId, path)}
            alt={path.split('/').at(-1) ?? 'Generated analysis plot'}
            loading="lazy"
            sx={{ display: 'block', width: '100%', background: '#faf7f0' }}
          />
          <Typography
            component="figcaption"
            sx={{ px: 1, py: 0.7, color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
          >
            {path}
          </Typography>
        </Box>
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

  if (!identity) return <Typography>Missing job identity.</Typography>;
  if (error) {
    return (
      <Stack direction="row" sx={{ p: 2, gap: 1, color: '#9a4538' }}>
        <ErrorOutlineRounded />
        <Typography>{error}</Typography>
      </Stack>
    );
  }
  if (!resource) {
    return (
      <Stack sx={{ gap: 1.2 }}>
        <Skeleton variant="rounded" height={74} />
        <Skeleton variant="rounded" height={360} />
      </Stack>
    );
  }
  return (
    <Stack sx={{ gap: 1.4, p: { xs: 1.2, md: 2 } }}>
      <Box
        sx={{
          p: 1.5,
          border: `1px solid ${tokens.hair}`,
          borderLeft: `2px solid ${tokens.teal}`,
          borderRadius: 1.1,
          background: 'rgba(31,111,107,.035)',
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ gap: 1.1 }}>
          <CheckCircleOutlineRounded sx={{ color: tokens.teal, fontSize: 18 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 15, fontWeight: 700 }}>
              {JOB_LABELS[resource.jobKind]}
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9 }}>
              {resource.artifactPath}
            </Typography>
          </Box>
          <ButtonBase
            onClick={() => window.history.back()}
            sx={{ ml: 'auto', px: 0.9, py: 0.5, gap: 0.45, color: tokens.sub, fontSize: 10 }}
          >
            <ArrowBackRounded sx={{ fontSize: 14 }} /> Back
          </ButtonBase>
        </Stack>
        <Box sx={{ mt: 1 }}>
          <MetadataTags values={{ ...resource.descriptor, ...(resource.summary ?? {}) }} />
        </Box>
      </Box>

      {resource.curve && <KernelCurve curve={resource.curve} />}
      <PlotGallery resource={resource} />
      {resource.iterBreakdown && (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.4,
            maxHeight: 520,
            overflow: 'auto',
            border: `1px solid ${tokens.hair}`,
            borderRadius: 1.1,
            color: tokens.ink,
            background: '#f6f1e8',
            fontFamily: tokens.mono,
            fontSize: 10.5,
            lineHeight: 1.6,
          }}
        >
          {resource.iterBreakdown}
        </Box>
      )}
      {!resource.curve &&
        !resource.iterBreakdown &&
        !resource.files.some((path) => /\.(png|jpe?g|webp)$/i.test(path)) && (
          <Typography sx={{ p: 2, color: tokens.sub }}>
            This job has no readable result artifact yet.
          </Typography>
        )}
    </Stack>
  );
}
