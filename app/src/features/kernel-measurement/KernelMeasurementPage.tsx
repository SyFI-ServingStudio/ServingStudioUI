import { Stack, Typography } from '@mui/material';
import { useEffect } from 'react';

import {
  useHardwareGpuQuery,
  useKernelMeasurementQueries,
} from '../../application/queries';
import { replaceAnalyzerEvidenceHref } from '../../domain/analyzerNavigation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import {
  MeasurementSummary,
  MetadataTags,
  PlotGallery,
} from '../offline/OfflineResultComponents';
import { useOfflineEvidenceNavigation } from '../offline/useOfflineEvidenceNavigation';

export function KernelMeasurementPage({ measurementId }: { readonly measurementId: string }) {
  const workspaceId = new URLSearchParams(window.location.hash.split('?', 2)[1] ?? '').get('workspace');
  const queries = useKernelMeasurementQueries(measurementId);
  const gpuName =
    queries.descriptor.data?.gpu.observedName ?? queries.descriptor.data?.gpu.cacheKey ?? null;
  const hardware = useHardwareGpuQuery(gpuName);
  const selection = useViz((state) => state.kernelMeasurementSelection);
  const setSelection = useViz((state) => state.setKernelMeasurementSelection);
  const active =
    selection?.workspaceId === workspaceId && selection.measurementId === measurementId
      ? selection
      : null;
  const activeEvidenceId =
    active?.panelId === 'summary' && active.metricKey
      ? `kernel-measurement:summary:${active.metricKey}`
      : active?.panelId === 'plot' && active.plotName
        ? `kernel-measurement:plot:${active.plotName}`
        : null;
  useOfflineEvidenceNavigation(activeEvidenceId, Boolean(queries.summary.data));

  useEffect(() => {
    if (!workspaceId) return;
    const current = useViz.getState().kernelMeasurementSelection;
    if (current?.workspaceId === workspaceId && current.measurementId === measurementId) return;
    setSelection({
      kind: 'kernel_measurement',
      workspaceId,
      measurementId,
      panelId: null,
      metricKey: null,
      plotName: null,
    });
  }, [measurementId, setSelection, workspaceId]);

  if (!workspaceId) return <Typography>Missing workspace identity.</Typography>;
  if (!queries.descriptor.data || !queries.summary.data) {
    return (
      <Typography sx={{ p: 2, color: queries.summary.isError ? tokens.terra : tokens.sub }}>
        {queries.summary.isError
          ? 'Kernel measurement could not be loaded from Analyzer.'
          : 'Kernel measurement is pending in Analyzer.'}
      </Typography>
    );
  }
  const descriptor = queries.descriptor.data;
  const selectSummary = (metricKey: string) => {
    const next = {
      kind: 'kernel_measurement' as const,
      workspaceId,
      measurementId,
      panelId: 'summary',
      metricKey,
      plotName: null,
    };
    setSelection(next);
    replaceAnalyzerEvidenceHref({ protocol: 'vibesim.analyzer/v2', ...next });
  };
  const selectPlot = (plotName: string) => {
    const next = {
      kind: 'kernel_measurement' as const,
      workspaceId,
      measurementId,
      panelId: 'plot',
      metricKey: null,
      plotName,
    };
    setSelection(next);
    replaceAnalyzerEvidenceHref({ protocol: 'vibesim.analyzer/v2', ...next });
  };
  return (
    <Stack sx={{ gap: 1.4, p: { xs: 1.2, md: 2 } }}>
      <MetadataTags
        values={{
          kernel: descriptor.kernel.kind,
          backend: descriptor.kernel.backend,
          gpu: descriptor.gpu.observedName ?? descriptor.gpu.cacheKey,
          duration_s: descriptor.durationSeconds,
          hbm_gbps: hardware.data?.hbmBandwidthGbps,
          interconnect_one_way_gbps: hardware.data?.interconnect?.oneWayGbps,
          ...descriptor.shape,
        }}
      />
      <MeasurementSummary
        summary={queries.summary.data}
        selectedMetric={active?.panelId === 'summary' ? active.metricKey : null}
        onMetricSelect={selectSummary}
      />
      <PlotGallery
        descriptor={descriptor}
        selectedPlot={active?.panelId === 'plot' ? active.plotName : null}
        onPlotSelect={selectPlot}
      />
    </Stack>
  );
}
