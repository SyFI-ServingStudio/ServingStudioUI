import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useEffect, useState } from 'react';

import { useActiveRunState, useActiveRunSubject } from '../../application/ActiveRunProvider';
import {
  useIterationOptimalityKernelLadderQuery,
  useIterationOptimalityWaterfallQuery,
} from '../../application/queries';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { leafById } from '../../domain/cost-tree';
import type { OptimalityMode } from '../../domain/optimality';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import {
  OptimalityBreakdownCard,
  OptimalityKernelLadderCard,
  OptimalityKernelsCard,
  OptimalityWaterfallCard,
  projectAggregateKernelLadder,
  projectExactKernelLadder,
  projectIterationOptimalityBreakdown,
  type OptimalityBreakdownProjection,
  type KernelLadderProjection,
} from '../metrics';

/** Scope-adaptive optimality section. Aggregate scopes consume the bounded
 * subject; an exact operation switches worker/kernel views to the on-demand
 * iteration endpoint without mixing run-aggregate and iteration data. */
export default function OptimalityAnalysisStage() {
  const activeRun = useActiveRunState();
  const [mode, setMode] = useState<OptimalityMode>('unlocked');
  const optimalityArtifact =
    activeRun.status === 'ready' ? activeRun.descriptor.subjects.optimality : undefined;
  const batchLockedAvailable =
    optimalityArtifact?.status === 'ready' &&
    optimalityArtifact.variants?.batch_locked !== undefined;
  const activeRunId = activeRun.status === 'ready' ? activeRun.run.id : null;
  useEffect(() => {
    if (!batchLockedAvailable) setMode('unlocked');
  }, [activeRunId, batchLockedAvailable]);
  const optimality = useActiveRunSubject(
    'optimality',
    mode === 'batch_locked' ? 'batch_locked' : undefined,
  );
  const treeState = useActiveWorkerTreeState();
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const selectedOperation = useViz((state) => state.operation);
  const selectedLeafId = useViz((state) => state.leafId);

  const selectedWorker =
    activeRun.status === 'ready'
      ? activeRun.run.workerList.find((worker) => worker.key === workerKey)
      : undefined;
  const iterationDetail =
    activeRun.status === 'ready'
      ? activeRun.descriptor.details['iteration-optimality-kernel-ladder']
      : undefined;
  const iterationWaterfallDetail =
    activeRun.status === 'ready'
      ? activeRun.descriptor.details['iteration-optimality-waterfall']
      : undefined;
  const iterationQuery = useIterationOptimalityKernelLadderQuery(
    activeRun.status === 'ready' ? activeRun.run.id : '',
    selectedWorker?.ref,
    selectedOperation?.iterId,
    activeRun.status === 'ready' ? activeRun.descriptor.analysis?.revision : undefined,
    mode,
    scope !== 'cluster' &&
      scope !== 'pool' &&
      selectedOperation !== null &&
      iterationDetail?.status === 'ready',
  );
  const iterationWaterfallQuery = useIterationOptimalityWaterfallQuery(
    activeRun.status === 'ready' ? activeRun.run.id : '',
    selectedWorker?.ref,
    selectedOperation?.iterId,
    activeRun.status === 'ready' ? activeRun.descriptor.analysis?.revision : undefined,
    mode,
    scope !== 'cluster' &&
      scope !== 'pool' &&
      selectedOperation !== null &&
      iterationWaterfallDetail?.status === 'ready',
  );

  const modeSwitch = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      aria-label="Optimality batch-size mode"
      onChange={(_event, nextMode: OptimalityMode | null) => {
        if (nextMode !== null) setMode(nextMode);
      }}
      sx={{
        alignSelf: 'flex-start',
        '& .MuiToggleButton-root': {
          px: 1,
          py: 0.2,
          fontFamily: tokens.mono,
          fontSize: 9.5,
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
  );

  if (scope === 'cluster') {
    const ladder = projectAggregateKernelLadder(optimality, { kind: 'cluster' });
    return (
      <Stack spacing={2}>
        {modeSwitch}
        <OptimalityBreakdownCard
          idx="a"
          title="Cluster optimality waterfall"
          subject={optimality}
          scope={{ kind: 'cluster' }}
        />
        <OptimalityKernelLadderCard
          idx="b"
          title="Cluster kernel optimality ladder"
          projection={ladder}
        />
        <OptimalityKernelsCard idx="c" title="Cluster per-kernel optimality" projection={ladder} />
      </Stack>
    );
  }

  if (scope === 'pool') {
    const poolTag = poolRole ?? '';
    const ladder = projectAggregateKernelLadder(optimality, { kind: 'pool', poolTag });
    return (
      <Stack spacing={2}>
        {modeSwitch}
        <OptimalityBreakdownCard
          idx="a"
          title={`Pool optimality waterfall · ${poolTag}`}
          subject={optimality}
          scope={{ kind: 'pool', poolTag }}
        />
        <OptimalityKernelLadderCard
          idx="b"
          title={`Pool kernel optimality ladder · ${poolTag}`}
          projection={ladder}
        />
        <OptimalityKernelsCard
          idx="c"
          title={`Pool per-kernel optimality · ${poolTag}`}
          projection={ladder}
        />
      </Stack>
    );
  }

  const selectedKernelName =
    scope === 'kernel' && selectedLeafId !== null && treeState.status === 'ready'
      ? (leafById(treeState.tree, selectedLeafId)?.slot.name ?? null)
      : null;
  let ladder: KernelLadderProjection;
  if (selectedWorker === undefined || workerKey === null) {
    ladder = { status: 'scope_missing', reason: 'No worker is selected.' };
  } else if (selectedOperation === null) {
    ladder = projectAggregateKernelLadder(
      optimality,
      { kind: 'worker', workerKey },
      selectedKernelName,
    );
  } else if (iterationDetail?.status !== 'ready') {
    ladder = {
      status: iterationDetail?.status ?? 'not_generated',
      reason:
        iterationDetail && 'reason' in iterationDetail
          ? (iterationDetail.reason ?? 'Exact iteration optimality is unavailable.')
          : 'Run descriptor does not declare exact iteration optimality.',
    };
  } else if (!iterationQuery.supported) {
    ladder = {
      status: 'not_generated',
      reason: 'Exact iteration optimality requires the live Analyzer service.',
    };
  } else if (iterationQuery.isError) {
    ladder = {
      status: 'failed',
      code: 'iteration_optimality_load_failed',
      reason:
        iterationQuery.error instanceof Error
          ? iterationQuery.error.message
          : 'Could not load exact iteration optimality.',
    };
  } else if (iterationQuery.data === undefined) {
    ladder = { status: 'pending', reason: 'Loading exact iteration optimality.' };
  } else {
    ladder = projectExactKernelLadder(iterationQuery.data, selectedKernelName);
  }

  let iterationWaterfall: OptimalityBreakdownProjection | null = null;
  if (selectedOperation !== null) {
    if (iterationWaterfallDetail?.status !== 'ready') {
      iterationWaterfall = {
        status: iterationWaterfallDetail?.status ?? 'not_generated',
        reason:
          iterationWaterfallDetail && 'reason' in iterationWaterfallDetail
            ? (iterationWaterfallDetail.reason ?? 'Exact iteration waterfall is unavailable.')
            : 'Run descriptor does not declare exact iteration waterfall.',
      };
    } else if (!iterationWaterfallQuery.supported) {
      iterationWaterfall = {
        status: 'not_generated',
        reason: 'Exact iteration waterfall requires the live Analyzer service.',
      };
    } else if (iterationWaterfallQuery.isError) {
      iterationWaterfall = {
        status: 'failed',
        code: 'iteration_optimality_waterfall_load_failed',
        reason:
          iterationWaterfallQuery.error instanceof Error
            ? iterationWaterfallQuery.error.message
            : 'Could not load exact iteration waterfall.',
      };
    } else if (iterationWaterfallQuery.data === undefined) {
      iterationWaterfall = { status: 'pending', reason: 'Loading exact iteration waterfall.' };
    } else {
      iterationWaterfall = projectIterationOptimalityBreakdown(iterationWaterfallQuery.data);
    }
  }

  const ladderTitle = selectedKernelName
    ? `Kernel optimality ladder · ${selectedKernelName}`
    : selectedOperation
      ? `Iteration kernel optimality ladder · iter ${selectedOperation.iterId}`
      : `Worker kernel optimality ladder · ${selectedWorker?.key ?? ''}`;
  const headroomTitle = selectedKernelName
    ? `Kernel optimality sources · ${selectedKernelName}`
    : selectedOperation
      ? `Iteration per-kernel optimality · iter ${selectedOperation.iterId}`
      : `Worker per-kernel optimality · ${selectedWorker?.key ?? ''}`;

  return (
    <Stack spacing={2}>
      {modeSwitch}
      {iterationWaterfall !== null && (
        <OptimalityWaterfallCard
          idx="a"
          title={`Iteration optimality waterfall · ${selectedWorker?.key ?? ''} · iter ${selectedOperation?.iterId ?? ''}`}
          projection={iterationWaterfall}
        />
      )}
      <OptimalityKernelLadderCard
        idx={iterationWaterfall === null ? 'a' : 'b'}
        title={ladderTitle}
        projection={ladder}
      />
      <OptimalityKernelsCard
        idx={iterationWaterfall === null ? 'b' : 'c'}
        title={headroomTitle}
        projection={ladder}
      />
    </Stack>
  );
}
