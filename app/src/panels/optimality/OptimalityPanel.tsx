import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useMemo } from 'react';

import {
  runDescriptorRef,
  runOptimalityRef,
  useArtifact,
  type ArtifactResult,
  iterationOptimalityKernelLadderRef,
  iterationOptimalityWaterfallRef,
  type WorkerCoordinate,
} from '../../artifacts';
import { segmentOf, withOption } from '../../location';
import type { OptimalityDecodeResult, OptimalityMode } from '../../artifacts';
import { tokens } from '../../ui/theme';
import type { PanelProps } from '../types';
import type { SubjectResult } from '../subjectResult';
import OptimalityBreakdownCard, {
  OptimalityWaterfallCard,
} from '../shared/OptimalityBreakdownCard';
import OptimalityKernelLadderCard from '../shared/OptimalityKernelLadderCard';
import OptimalityKernelsCard from '../shared/OptimalityKernelsCard';
import { projectScopedKernelLadder } from '../shared/optimalityKernelLadder';
import { projectExactKernelLadder } from '../shared/optimalityKernelLadder';
import { projectIterationOptimalityBreakdown } from '../shared/optimalityBreakdown';
import type { KernelLadderProjection } from '../shared/optimalityKernelLadder';
import type { OptimalityBreakdownProjection } from '../shared/optimalityBreakdown';
import { evidenceSelection } from '../evidenceSelection';
import { workerOf } from '../coordinate';

function subjectOf(result: ArtifactResult<OptimalityDecodeResult>): SubjectResult<'optimality'> {
  if (result.status === 'ready') return result.value;
  if (result.status === 'incompatible') {
    return {
      subject: 'optimality',
      status: 'incompatible',
      reason: result.reason,
      ...(result.received === undefined ? {} : { receivedSchemaVersion: result.received }),
    };
  }
  return { subject: 'optimality', ...result };
}

export function RunOptimalityPanel({ location, navigate }: PanelProps) {
  const run = location.ref as typeof location.ref & { readonly kind: 'run' };
  const mode: OptimalityMode =
    location.focus.options.optimality === 'batch_locked' ? 'batch_locked' : 'unlocked';
  const subjectState = useArtifact(useMemo(() => runOptimalityRef(run, mode), [run, mode]));
  const descriptorState = useArtifact(useMemo(() => runDescriptorRef(run), [run]));
  const subject = subjectOf(subjectState);
  const pool = segmentOf(location.focus.path, 'pool');
  const worker = segmentOf(location.focus.path, 'worker');
  const operation = segmentOf(location.focus.path, 'operation');
  const scope =
    pool === null
      ? ({ kind: 'cluster' } as const)
      : worker === null
        ? ({ kind: 'pool', poolTag: pool.role } as const)
        : ({
            kind: 'worker',
            workerKey: `${encodeURIComponent(pool.role)}/${encodeURIComponent(worker.id)}`,
          } as const);
  const ladderTitle =
    scope.kind === 'cluster'
      ? 'Cluster kernel optimality ladder'
      : scope.kind === 'pool'
        ? `Pool kernel optimality ladder · ${scope.poolTag}`
        : `Worker kernel optimality ladder · ${pool?.role ?? ''}/${worker?.id ?? ''}`;
  const kernelsTitle =
    scope.kind === 'cluster'
      ? 'Cluster per-kernel optimality'
      : scope.kind === 'pool'
        ? `Pool per-kernel optimality · ${scope.poolTag}`
        : `Worker per-kernel optimality · ${pool?.role ?? ''}/${worker?.id ?? ''}`;
  const ladder = projectScopedKernelLadder(subject, scope);
  const optimalityCapability =
    descriptorState.status === 'ready' ? descriptorState.value.subjects.optimality : undefined;
  const batchLockedAvailable =
    optimalityCapability?.status === 'ready' &&
    optimalityCapability.variants?.batch_locked !== undefined;

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={mode}
        aria-label="Optimality batch-size mode"
        onChange={(_event, nextMode: OptimalityMode | null) => {
          if (nextMode === null) return;
          navigate(
            { ...location, focus: withOption(location.focus, 'optimality', nextMode) },
            'replace',
          );
        }}
        sx={{
          alignSelf: 'flex-start',
          '& .MuiToggleButton-root': {
            px: 1,
            py: 0.2,
            fontFamily: tokens.body,
            fontSize: 12,
            lineHeight: 1.45,
            color: tokens.sub,
            borderColor: tokens.hair,
            '&.Mui-selected': { color: tokens.teal, backgroundColor: tokens.tile2 },
          },
        }}
      >
        <ToggleButton value="unlocked">Batch unlocked</ToggleButton>
        <ToggleButton value="batch_locked" disabled={!batchLockedAvailable}>
          Batch locked
        </ToggleButton>
      </ToggleButtonGroup>
      {scope.kind !== 'worker' && (
        <OptimalityBreakdownCard
          idx="a"
          title={
            scope.kind === 'cluster'
              ? 'Cluster optimality waterfall'
              : `Pool optimality waterfall · ${scope.poolTag}`
          }
          subject={subject}
          scope={scope}
          evidence={evidenceSelection(location, navigate, 'optimality-breakdown')}
        />
      )}
      {scope.kind === 'worker' && operation !== null ? (
        <IterationOptimalityCards
          location={location}
          navigate={navigate}
          worker={workerOf(location.focus)!}
          iterId={operation.iter}
          mode={mode}
        />
      ) : (
        <>
          <OptimalityKernelLadderCard
            idx={scope.kind === 'worker' ? 'a' : 'b'}
            title={ladderTitle}
            projection={ladder}
            evidence={evidenceSelection(location, navigate, 'optimality-kernel-ladder')}
          />
          <OptimalityKernelsCard
            idx={scope.kind === 'worker' ? 'b' : 'c'}
            title={kernelsTitle}
            projection={ladder}
            evidence={evidenceSelection(location, navigate, 'optimality-kernels')}
          />
        </>
      )}
    </Stack>
  );
}

function problemProjection<T extends KernelLadderProjection | OptimalityBreakdownProjection>(
  result: Exclude<ArtifactResult<unknown>, { status: 'ready' }>,
): T {
  return {
    status: result.status,
    ...('reason' in result ? { reason: result.reason } : {}),
    ...('code' in result ? { code: result.code } : {}),
  } as T;
}

function IterationOptimalityCards({
  location,
  navigate,
  worker,
  iterId,
  mode,
}: PanelProps & {
  readonly worker: WorkerCoordinate;
  readonly iterId: string;
  readonly mode: OptimalityMode;
}) {
  const run = location.ref as typeof location.ref & { readonly kind: 'run' };
  const ladderState = useArtifact(
    useMemo(
      () => iterationOptimalityKernelLadderRef(run, worker, iterId, mode),
      [iterId, mode, run, worker],
    ),
  );
  const waterfallState = useArtifact(
    useMemo(
      () => iterationOptimalityWaterfallRef(run, worker, iterId, mode),
      [iterId, mode, run, worker],
    ),
  );
  const ladder =
    ladderState.status === 'ready'
      ? projectExactKernelLadder(ladderState.value)
      : problemProjection<KernelLadderProjection>(ladderState);
  const waterfall =
    waterfallState.status === 'ready'
      ? projectIterationOptimalityBreakdown(waterfallState.value)
      : problemProjection<OptimalityBreakdownProjection>(waterfallState);
  const workerKey = `${worker.poolTag}/${worker.workerId}`;
  return (
    <>
      <OptimalityWaterfallCard
        idx="a"
        title={`Iteration optimality waterfall · ${workerKey} · iter ${iterId}`}
        projection={waterfall}
        evidence={evidenceSelection(location, navigate, 'optimality-breakdown')}
      />
      <OptimalityKernelLadderCard
        idx="b"
        title={`Iteration kernel optimality ladder · iter ${iterId}`}
        projection={ladder}
        evidence={evidenceSelection(location, navigate, 'optimality-kernel-ladder')}
      />
      <OptimalityKernelsCard
        idx="c"
        title={`Iteration per-kernel optimality · iter ${iterId}`}
        projection={ladder}
        evidence={evidenceSelection(location, navigate, 'optimality-kernels')}
      />
    </>
  );
}
