import { Box, Stack, Typography } from '@mui/material';

import SurfaceCard from '../ui/controls/SurfaceCard';
import type { LeafNode } from './costTreeModel';
import type { KernelThroughputAnalysisData } from './kernelThroughputTypes';
import type { SubjectResult } from './subjectResult';
import { tokens } from '../ui/theme';
import { KernelInputDistributionEvidenceView } from './KernelInputDistributionEvidenceView';
import KernelThroughputAnalysis from './KernelThroughputAnalysisView';

export interface KernelAnalysisState {
  readonly data?: KernelThroughputAnalysisData;
  readonly supported: boolean;
  readonly isError: boolean;
  readonly error?: unknown;
  readonly evidenceStatus?: 'loading' | 'unavailable' | 'not_generated' | 'failed' | 'incompatible';
  readonly reason?: string;
}

export function KernelEvidenceView({
  node,
  analysis,
  distributionSubject,
}: {
  node: LeafNode;
  analysis: KernelAnalysisState;
  distributionSubject: SubjectResult<'kernelInputDistribution'>;
}) {
  const evidenceStatus =
    analysis.evidenceStatus ??
    (!analysis.supported ? 'unavailable' : analysis.isError ? 'failed' : 'loading');
  return (
    <Box
      data-testid="kernel-evidence"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(2,minmax(0,1fr))' },
        gap: 1.5,
        p: 1.5,
        borderTop: `1px solid ${tokens.hair}`,
      }}
    >
      {analysis.data !== undefined ? (
        <SurfaceCard data-testid="kernel-throughput-analysis-card" sx={{ p: '14px 14px 12px' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'baseline' }}
            spacing={0.5}
          >
            <Typography
              component="h3"
              sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}
            >
              Kernel throughput analysis
            </Typography>
            <Typography sx={{ fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
              Rust cache · {analysis.data.points.length.toLocaleString()} grid points
            </Typography>
          </Stack>
          <KernelThroughputAnalysis analysis={analysis.data} node={node} />
          <Typography sx={{ mt: 0.6, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
            current operation is plotted as a separate marker
          </Typography>
        </SurfaceCard>
      ) : (
        <SurfaceCard
          role={evidenceStatus === 'failed' ? 'alert' : 'status'}
          accent={evidenceStatus === 'failed' ? tokens.terra : tokens.gold}
          sx={{ p: 1.5 }}
        >
          <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
            Kernel throughput analysis
          </Typography>
          <Typography sx={{ mt: 0.35, fontFamily: tokens.body, fontSize: 12, color: tokens.sub }}>
            {analysis.reason ??
              (!analysis.supported
                ? 'Available through the live Analyzer service.'
                : analysis.isError
                  ? analysis.error instanceof Error
                    ? analysis.error.message
                    : 'Kernel throughput analysis failed.'
                  : 'Evaluating the Rust kernel cache across its declared grid…')}
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.body, fontSize: 12, color: tokens.sub2 }}>
            evidence status · {evidenceStatus}
          </Typography>
        </SurfaceCard>
      )}
      <KernelInputDistributionEvidenceView
        subject={distributionSubject}
        positionName={node.slot.name}
        currentInput={node.stats.input}
      />
    </Box>
  );
}
