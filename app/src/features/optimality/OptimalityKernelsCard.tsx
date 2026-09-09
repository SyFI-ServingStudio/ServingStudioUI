import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useState } from 'react';

import { OPTIMALITY_EPSILON_GPU_S } from '../../domain/optimality';
import {
  OPTIMALITY_KERNEL_FAMILIES,
  OPTIMALITY_KERNEL_NECESSARY_WORK_FAMILIES,
  optimalityStackOption,
} from './optimalityOption';
import { CHART_THEME } from '../../charts/platform';
import ChartCard from '../../components/ChartCard';
import {
  projectKernelHeadroom,
  type KernelHeadroomProjection,
  type KernelLadderProjection,
} from './optimalityKernelLadder';
import { tokens } from '../../theme';

type ScaleMode = 'real' | 'normalized';

function unavailableMessage(projection: KernelHeadroomProjection): string {
  if (projection.status === 'scope_missing') return projection.reason;
  if (projection.status === 'ready') return '';
  const reason = 'reason' in projection ? projection.reason : undefined;
  const code = 'code' in projection ? projection.code : undefined;
  return [
    `Optimality subject is ${projection.status.replace('_', ' ')}.`,
    code ? `[${code}]` : '',
    reason ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Per-kernel headroom: each location's balanced Real GPU·seconds split into
 * batching / communication / hardware-gap / hardware-optimal (top-N + `other`). */
export default function OptimalityKernelsCard({
  idx,
  title,
  projection: ladderProjection,
}: {
  idx?: string;
  title: string;
  projection: KernelLadderProjection;
}) {
  const [scaleMode, setScaleMode] = useState<ScaleMode>('real');
  const projection = projectKernelHeadroom(ladderProjection);
  if (projection.status !== 'ready') {
    return (
      <ChartCard
        evidenceId="optimality-kernels"
        idx={idx}
        title={title}
        sub={projection.status.replace('_', ' ')}
        option={null}
        empty={unavailableMessage(projection)}
        caption="Analyzer optimality subject per-kernel breakdown status."
      />
    );
  }

  const reportable = projection.rows.some((row) => row.total > OPTIMALITY_EPSILON_GPU_S);
  const rowSummary =
    projection.collapsedKernelCount > 0
      ? `${projection.rows.length - 1} kernels + ${projection.collapsedKernelCount} in other`
      : `${projection.rows.length} ${projection.rows.length === 1 ? 'kernel' : 'kernels'}`;
  const scaleDescription =
    scaleMode === 'normalized'
      ? 'Each kernel bar is independently normalized to 100%.'
      : 'Bar length uses real GPU·seconds.';
  const hasNecessaryWork = projection.rows.some((row) => row.values.necessaryCovered !== undefined);
  const attributionDescription = hasNecessaryWork
    ? `R5 is split into necessary and redundant work; a red diamond marks ${projection.underAccountedKernelCount} location(s) where the independent necessary floor exceeds R5 by more than the analyzer's 0.5% sampling tolerance.`
    : 'R5 remains the hardware-optimal floor because mapped necessary work is unavailable for this scope.';
  const controls = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={scaleMode}
      onChange={(_, value: ScaleMode | null) => {
        if (value !== null) setScaleMode(value);
      }}
      aria-label="Per-kernel optimality scale"
      sx={{
        '& .MuiToggleButton-root': {
          px: 0.8,
          py: 0.15,
          fontFamily: tokens.body,
          fontSize: 12,
          lineHeight: 1.45,
          color: tokens.sub,
          borderColor: tokens.hair,
          whiteSpace: 'nowrap',
          '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
        },
      }}
    >
      <ToggleButton value="real">Real scale</ToggleButton>
      <ToggleButton value="normalized">Normalized</ToggleButton>
    </ToggleButtonGroup>
  );
  return (
    <ChartCard
      evidenceId="optimality-kernels"
      idx={idx}
      title={title}
      sub={`${projection.label} / ${rowSummary}`}
      controls={controls}
      option={
        reportable
          ? optimalityStackOption(
              projection.rows,
              hasNecessaryWork
                ? OPTIMALITY_KERNEL_NECESSARY_WORK_FAMILIES
                : OPTIMALITY_KERNEL_FAMILIES,
              CHART_THEME,
              { normalized: scaleMode === 'normalized' },
            )
          : null
      }
      height={Math.max(200, projection.rows.length * 26 + 96)}
      empty={reportable ? undefined : 'No per-kernel GPU·seconds recorded.'}
      caption={`Each kernel location's balanced GPU·seconds, split by R2-R3 batching loss, R3-R4 communication cost, and R4-R5 hardware gap. ${attributionDescription} Idle and critical-path imbalance are aggregate-only. ${scaleDescription}`}
    />
  );
}
