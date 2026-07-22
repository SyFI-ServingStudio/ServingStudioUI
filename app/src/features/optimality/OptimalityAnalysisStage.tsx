import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { useEffect, useState } from 'react';

import { useActiveRunState, useActiveRunSubject } from '../../application/ActiveRunProvider';
import { useIterationOptimalityKernelLadderQuery } from '../../application/queries';
import { useActiveWorkerTreeState } from '../../application/WorkerTreeProvider';
import { leafById } from '../../domain/cost-tree';
import type { OptimalityMode } from '../../domain/optimality';
import { useViz } from '../../store';
import {
  OptimalityBreakdownCard,
  OptimalityKernelLadderCard,
  OptimalityKernelsCard,
  projectAggregateKernelLadder,
  projectExactKernelLadder,
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

  const modeSwitch = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      aria-label="Optimality batch-size mode"
      onChange={(_event, nextMode: OptimalityMode | null) => {
        if (nextMode !== null) setMode(nextMode);
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
      <OptimalityKernelLadderCard idx="a" title={ladderTitle} projection={ladder} />
      <OptimalityKernelsCard idx="b" title={headroomTitle} projection={ladder} />
    </Stack>
  );
}
