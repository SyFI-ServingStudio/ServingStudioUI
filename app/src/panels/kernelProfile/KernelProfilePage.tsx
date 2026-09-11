import { Stack, Typography } from '@mui/material';

import { kernelProfileCurveRef, kernelProfileDescriptorRef, useArtifact } from '../../artifacts';
import { withOption, withPanel } from '../../location';
import type { PanelProps } from '../types';
import AnalysisPageHeader from '../../ui/controls/AnalysisPageHeader';
import { pageLayout } from '../../ui/theme/metrics';
import { tokens } from '../../ui/theme';
import { KernelCurve } from '../shared/OfflineResultComponents';

export function KernelProfilePage({ location, navigate }: PanelProps) {
  if (location.ref.kind !== 'kernelProfile') return null;
  const result = { ...location.ref, kind: 'kernelProfile' as const };
  return <KernelProfileContent location={location} navigate={navigate} result={result} />;
}

function KernelProfileContent({
  location,
  navigate,
  result,
}: PanelProps & { readonly result: Parameters<typeof kernelProfileDescriptorRef>[0] }) {
  const descriptor = useArtifact(kernelProfileDescriptorRef(result));
  const curve = useArtifact(kernelProfileCurveRef(result));
  if (descriptor.status !== 'ready' || curve.status !== 'ready') {
    const failed = [descriptor, curve].some(
      (artifact) => artifact.status !== 'pending' && artifact.status !== 'ready',
    );
    return (
      <Typography sx={{ p: 2, color: failed ? tokens.terra : tokens.sub }}>
        {failed
          ? 'Kernel profile could not be loaded from Analyzer.'
          : 'Kernel profile is pending in Analyzer.'}
      </Typography>
    );
  }
  const selectedMetric =
    location.focus.panel === 'curve' ? (location.focus.options.metric ?? null) : null;
  const selectMetric = (metric: string) => {
    const focus = withOption(withPanel(location.focus, 'curve'), 'metric', metric);
    navigate({ ...location, focus }, 'replace');
  };
  return (
    <Stack sx={{ gap: 2.5, py: 4, ...pageLayout, mx: 'auto' }}>
      <AnalysisPageHeader title="Kernel profile" />
      <KernelCurve
        curve={curve.value}
        selectedMetric={selectedMetric}
        onMetricSelect={selectMetric}
        descriptor={{
          backend: descriptor.value.kernel.backend,
          family: descriptor.value.kernel.metricFamily,
          gpu: descriptor.value.gpu?.observedName ?? descriptor.value.gpu?.cacheKey,
          profile_action:
            descriptor.value.mode === 'jit-fill'
              ? 'filled missing points'
              : descriptor.value.mode === 'force-refresh'
                ? 'refreshed all points'
                : descriptor.value.mode,
          source: descriptor.value.legacy ? 'legacy profile' : undefined,
          data_source:
            descriptor.value.provenanceSource === 'measurement'
              ? 'measured now'
              : descriptor.value.provenanceSource === 'cache_key'
                ? 'profile cache'
                : undefined,
        }}
      />
    </Stack>
  );
}
