import { pageLayout } from '../../theme/metrics';
import AnalysisPageHeader from '../../components/AnalysisPageHeader';
import { Stack, Typography } from '@mui/material';
import { useEffect } from 'react';

import { useKernelProfileQueries } from '../../application/queries';
import { replaceAnalyzerEvidenceHref } from '../../domain/analyzerNavigation';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { KernelCurve } from '../offline/OfflineResultComponents';
import { useOfflineEvidenceNavigation } from '../offline/useOfflineEvidenceNavigation';

export function KernelProfilePage({ profileId }: { readonly profileId: string }) {
  const workspaceId = new URLSearchParams(window.location.hash.split('?', 2)[1] ?? '').get(
    'workspace',
  );
  const queries = useKernelProfileQueries(profileId);
  const selection = useViz((state) => state.kernelProfileSelection);
  const setSelection = useViz((state) => state.setKernelProfileSelection);
  const selectedMetric =
    selection?.workspaceId === workspaceId && selection.profileId === profileId
      ? selection.metricKey
      : null;
  useOfflineEvidenceNavigation(
    selectedMetric ? `kernel-profile:${selectedMetric}` : null,
    Boolean(queries.curve.data),
  );

  useEffect(() => {
    if (!workspaceId) return;
    const current = useViz.getState().kernelProfileSelection;
    if (current?.workspaceId === workspaceId && current.profileId === profileId) return;
    setSelection({
      kind: 'kernel_profile',
      workspaceId,
      profileId,
      panelId: null,
      metricKey: null,
    });
  }, [profileId, setSelection, workspaceId]);

  if (!workspaceId) return <Typography>Missing workspace identity.</Typography>;
  if (!queries.descriptor.data || !queries.curve.data) {
    return (
      <Typography sx={{ p: 2, color: queries.curve.isError ? tokens.terra : tokens.sub }}>
        {queries.curve.isError
          ? 'Kernel profile could not be loaded from Analyzer.'
          : 'Kernel profile is pending in Analyzer.'}
      </Typography>
    );
  }
  const descriptor = queries.descriptor.data;
  const selectMetric = (metricKey: string) => {
    const next = {
      kind: 'kernel_profile' as const,
      workspaceId,
      profileId,
      panelId: 'curve',
      metricKey,
    };
    setSelection(next);
    replaceAnalyzerEvidenceHref({ protocol: 'vibesim.analyzer/v2', ...next });
  };
  return (
    <Stack sx={{ gap: 2.5, py: 4, ...pageLayout, mx: 'auto' }}>
      <AnalysisPageHeader title="Kernel profile" />
      <KernelCurve
        curve={queries.curve.data}
        selectedMetric={selectedMetric}
        onMetricSelect={selectMetric}
        descriptor={{
          backend: descriptor.kernel.backend,
          family: descriptor.kernel.metricFamily,
          gpu: descriptor.gpu?.observedName ?? descriptor.gpu?.cacheKey,
          profile_action:
            descriptor.mode === 'jit-fill'
              ? 'filled missing points'
              : descriptor.mode === 'force-refresh'
                ? 'refreshed all points'
                : descriptor.mode,
          source: descriptor.legacy ? 'legacy profile' : undefined,
          data_source:
            descriptor.provenanceSource === 'measurement'
              ? 'measured now'
              : descriptor.provenanceSource === 'cache_key'
                ? 'profile cache'
                : undefined,
        }}
      />
    </Stack>
  );
}
