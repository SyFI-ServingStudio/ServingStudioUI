import { Box, Stack, Typography } from '@mui/material';

import { useActiveRunSubject } from '../../application/ActiveRunProvider';
import { CHART_THEME } from '../../charts/platform';
import EChart from '../../components/EChart';
import SurfaceCard from '../../components/SurfaceCard';
import type { JsonValue } from '../../domain/cost-tree';
import type { SubjectResult } from '../../domain/subject';
import { tokens } from '../../theme';
import { kernelInputDistributionOption } from './kernelInputDistributionOptions';

function reasonOf(subject: SubjectResult<'kernelInputDistribution'>): string {
  return 'reason' in subject && subject.reason
    ? subject.reason
    : `Analyzer subject ${subject.subject} is ${subject.status}.`;
}

function EvidenceState({
  subject,
  reason,
}: {
  subject: SubjectResult<'kernelInputDistribution'>;
  reason?: string;
}) {
  const failed = subject.status === 'failed';
  return (
    <SurfaceCard
      role={failed ? 'alert' : 'status'}
      accent={failed ? tokens.terra : tokens.gold}
      sx={{ p: 1.5 }}
    >
      <Typography sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
        Kernel input distribution
      </Typography>
      <Typography sx={{ mt: 0.35, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
        {reason ?? reasonOf(subject)}
      </Typography>
      <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
        evidence status · {subject.status}
      </Typography>
    </SurfaceCard>
  );
}

/** Run-aggregate backend choices for the currently selected CostTree position.
 * Position identity is the manifest leaf name; a ready payload with no exact
 * match remains an explicit evidence state rather than falling back by kind. */
export default function KernelInputDistributionEvidence({
  positionName,
  currentInput,
}: {
  positionName: string;
  currentInput: JsonValue;
}) {
  const subject = useActiveRunSubject('kernelInputDistribution');
  return (
    <KernelInputDistributionEvidenceView
      subject={subject}
      positionName={positionName}
      currentInput={currentInput}
    />
  );
}

export function KernelInputDistributionEvidenceView({
  subject,
  positionName,
  currentInput,
}: {
  subject: SubjectResult<'kernelInputDistribution'>;
  positionName: string;
  currentInput: JsonValue;
}) {
  if (subject.status !== 'ready') return <EvidenceState subject={subject} />;
  const position = subject.payload.positions.find((candidate) => candidate.name === positionName);
  if (position === undefined) {
    return (
      <EvidenceState
        subject={subject}
        reason={`Ready aggregate payload has no exact position ${positionName}.`}
      />
    );
  }

  const projectionLabel =
    position.projection === 'pca' && position.explainedVariance !== null
      ? `PCA · ${(position.explainedVariance[0] * 100).toFixed(1)}% + ${(position.explainedVariance[1] * 100).toFixed(1)}% variance`
      : position.projection.replace('_', ' ');
  const option = kernelInputDistributionOption(position, CHART_THEME, currentInput);

  return (
    <SurfaceCard data-testid="kernel-input-distribution" sx={{ p: '14px 14px 12px' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'baseline' }}
        spacing={0.5}
      >
        <Typography component="h3" sx={{ fontFamily: tokens.serif, fontSize: 14, fontWeight: 600 }}>
          Kernel input distribution
        </Typography>
        <Typography sx={{ fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
          sampled every {subject.payload.sampling.stride} iteration(s) · {projectionLabel}
        </Typography>
      </Stack>
      <Box
        component="dl"
        aria-label="Backend selection counts"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2,minmax(0,1fr))' },
          gap: 0.65,
          my: 1,
        }}
      >
        {position.selection.map((selection, index) => (
          <Box
            component="div"
            key={selection.backendIndex}
            sx={{
              display: 'grid',
              gridTemplateColumns: '8px minmax(0,1fr) auto',
              alignItems: 'center',
              gap: 0.7,
              minWidth: 0,
              px: 0.8,
              py: 0.55,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.75,
            }}
          >
            <Box
              aria-hidden="true"
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: CHART_THEME.palette[index % CHART_THEME.palette.length],
              }}
            />
            <Typography
              component="dt"
              sx={{
                fontFamily: tokens.mono,
                fontSize: 10,
                color: tokens.ink,
                overflowWrap: 'anywhere',
              }}
            >
              {selection.backendName}
            </Typography>
            <Typography
              component="dd"
              sx={{ m: 0, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}
            >
              {selection.count.toLocaleString()} · {(selection.ratio * 100).toFixed(1)}%
            </Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ height: 250 }}>
        <EChart
          option={option}
          ariaLabel={`Kernel input projection for ${position.name}, colored by selected backend.`}
        />
      </Box>
      <Typography sx={{ mt: 0.6, fontFamily: tokens.mono, fontSize: 9, color: tokens.sub2 }}>
        {position.points.length.toLocaleString()} deduplicated points · point size encodes sampled
        slot count · current operation is a diamond marker
      </Typography>
    </SurfaceCard>
  );
}
