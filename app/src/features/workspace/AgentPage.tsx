import { Box } from '@mui/material';
import { useEffect, useMemo } from 'react';

import { useSweepListQuery, useSweepQuery } from '../../application/queries';
import { analyzerEvidenceHref } from '../../domain/analyzerNavigation';
import AgentPane from './AgentWorkspace';
import { firstThroughputEvidence } from './agentEvidence';

function openFirstExperiment(
  sweepId: string,
  evidence: { panelId: string; metricKey: string } | undefined,
): void {
  const destination = new URL(window.location.href);
  destination.search = '?workspace=1&agent=1';
  destination.hash = analyzerEvidenceHref({
    protocol: 'vibesim.analyzer/v1',
    experimentId: sweepId,
    ...evidence,
  });
  window.location.assign(destination);
}

export default function AgentPage() {
  const sweepList = useSweepListQuery();
  const prompt =
    window.sessionStorage.getItem('vibesim.entry.prompt') ??
    'Find the best configuration in the latest simulation results.';
  const firstReady =
    sweepList.data?.find((entry) => entry.status === 'ready') ?? sweepList.data?.[0];
  const sweep = useSweepQuery(firstReady?.sweepId ?? null, firstReady?.status === 'ready');
  const throughputEvidence = useMemo(() => firstThroughputEvidence(sweep.data), [sweep.data]);
  useEffect(() => {
    document.title = 'VibeSim · Agent';
  }, []);
  return (
    <Box component="main" sx={{ width: '100%', minHeight: '100dvh', height: '100dvh' }}>
      <AgentPane
        full
        prompt={prompt}
        onClose={() => {
          const destination = new URL(window.location.href);
          destination.search = '';
          destination.hash = '#/';
          window.location.assign(destination);
        }}
        onEvidence={() => {
          if (firstReady) openFirstExperiment(firstReady.sweepId, throughputEvidence);
        }}
      />
    </Box>
  );
}
