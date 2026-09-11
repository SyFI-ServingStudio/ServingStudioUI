import { Stack, Typography } from '@mui/material';

import {
  hardwareGpuRef,
  kernelMeasurementDescriptorRef,
  kernelMeasurementSummaryRef,
  useArtifact,
  useArtifacts,
} from '../../artifacts';
import { withOption, withPanel } from '../../location';
import type { PanelProps } from '../types';
import AnalysisPageHeader from '../../ui/controls/AnalysisPageHeader';
import { pageLayout } from '../../ui/theme/metrics';
import { tokens } from '../../ui/theme';
import { MeasurementSummary, MetadataTags, PlotGallery } from '../shared/OfflineResultComponents';

export function KernelMeasurementPage({ location, navigate }: PanelProps) {
  if (location.ref.kind !== 'kernelMeasurement') return null;
  const result = { ...location.ref, kind: 'kernelMeasurement' as const };
  return <KernelMeasurementContent location={location} navigate={navigate} result={result} />;
}

function KernelMeasurementContent({
  location,
  navigate,
  result,
}: PanelProps & { readonly result: Parameters<typeof kernelMeasurementDescriptorRef>[0] }) {
  const descriptor = useArtifact(kernelMeasurementDescriptorRef(result));
  const summary = useArtifact(kernelMeasurementSummaryRef(result));
  const gpuName =
    descriptor.status === 'ready'
      ? (descriptor.value.gpu.observedName ?? descriptor.value.gpu.cacheKey)
      : null;
  const hardwareReads = useArtifacts(gpuName === null ? [] : [hardwareGpuRef(gpuName)]);
  if (descriptor.status !== 'ready' || summary.status !== 'ready') {
    const failed = [descriptor, summary].some(
      (artifact) => artifact.status !== 'pending' && artifact.status !== 'ready',
    );
    return (
      <Typography sx={{ p: 2, color: failed ? tokens.terra : tokens.sub }}>
        {failed
          ? 'Kernel measurement could not be loaded from Analyzer.'
          : 'Kernel measurement is pending in Analyzer.'}
      </Typography>
    );
  }
  const hardware = hardwareReads[0]?.status === 'ready' ? hardwareReads[0].value : null;
  const selectSummary = (metric: string) => {
    let focus = withPanel(location.focus, 'summary');
    focus = withOption(focus, 'metric', metric);
    focus = withOption(focus, 'plot', null);
    navigate({ ...location, focus }, 'replace');
  };
  const selectPlot = (plot: string) => {
    let focus = withPanel(location.focus, 'plot');
    focus = withOption(focus, 'metric', null);
    focus = withOption(focus, 'plot', plot);
    navigate({ ...location, focus }, 'replace');
  };
  return (
    <Stack sx={{ gap: 2.5, py: 4, ...pageLayout, mx: 'auto' }}>
      <AnalysisPageHeader title="Kernel measurement" detail={descriptor.value.kernel.kind} />
      <MetadataTags
        values={{
          kernel: descriptor.value.kernel.kind,
          backend: descriptor.value.kernel.backend,
          gpu: descriptor.value.gpu.observedName ?? descriptor.value.gpu.cacheKey,
          duration_s: descriptor.value.durationSeconds,
          hbm_gbps: hardware?.hbmBandwidthGbps,
          interconnect_one_way_gbps: hardware?.interconnect?.oneWayGbps,
          ...descriptor.value.shape,
        }}
      />
      <MeasurementSummary
        summary={summary.value}
        selectedMetric={
          location.focus.panel === 'summary' ? (location.focus.options.metric ?? null) : null
        }
        onMetricSelect={selectSummary}
      />
      <PlotGallery
        descriptor={descriptor.value}
        selectedPlot={
          location.focus.panel === 'plot' ? (location.focus.options.plot ?? null) : null
        }
        onPlotSelect={selectPlot}
      />
    </Stack>
  );
}
