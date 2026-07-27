import { Box, Button, Paper, Stack, Typography, useMediaQuery } from '@mui/material';
import { useEffect, useMemo, useRef } from 'react';

import { useActiveRun, useActiveRunSubject } from '../../application/ActiveRunProvider';
import {
  useActiveWorkerTreeState,
  type ActiveWorkerTreeState,
  type WorkerTreeNonReadyStatus,
} from '../../application/WorkerTreeProvider';
import { leafById } from '../../domain/cost-tree';
import type { OperationRef } from '../../domain/workerOperation';
import { useViz } from '../../store';
import ChartCard from '../../components/ChartCard';
import { KernelEvidence, KernelInspector, ParallelDetail } from '../kernel';
import { metricView, METRIC_CAPTIONS, METRIC_TITLES } from '../../metrics';
import { tokens } from '../../theme';
import CostTreeFlow from './CostTreeFlow';
import {
  COST_TREE_FRAME_HEIGHT,
  WORKER_WORKBENCH_HEIGHT,
  WORKER_WORKBENCH_HEIGHT_VAR,
  CostTreeFrame,
  CostTreeStatusViewport,
} from './CostTreeFrame';
import TimeShareBlocks from './TimeShareBlocks';
import { WorkerOperationTimeline } from '../timeline';
import WorkerBatchComposition from './WorkerBatchComposition';
import WorkerKernelPositionBreakdownCard from './WorkerKernelPositionBreakdownCard';
import WorkerRequestStateCard from './WorkerRequestStateCard';

export const WORKER_WORKBENCH_MIN_HEIGHT = 480;
export const WORKER_VIEWPORT_SAFE_GAP = 12;
export const WORKER_VIEWPORT_HEIGHT_VAR = '--worker-viewport-height';
export const WORKER_WORKBENCH_MIN_HEIGHT_VAR = '--worker-workbench-min-height';
export const WORKER_WORKBENCH_MAX_HEIGHT_VAR = '--worker-workbench-max-height';

function WorkerAggregateStage() {
  const scope = useViz((state) => state.scope);
  const poolRole = useViz((state) => state.poolRole);
  const workerKey = useViz((state) => state.workerKey);
  const cursorMs = useViz((state) => state.cursorMs);
  const run = useActiveRun();
  const utilizationSubject = useActiveRunSubject('utilization');
  const kvSubject = useActiveRunSubject('kv');
  const selection = useMemo(
    () => ({ scope, poolRole, workerKey, cursorMs }),
    [cursorMs, poolRole, scope, workerKey],
  );
  const utilization = metricView(utilizationSubject, run, selection);
  const kv = metricView(kvSubject, run, selection);

  return (
    <Stack spacing={2}>
      <Box
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}
      >
        <ChartCard
          evidenceId="utilization"
          idx="a"
          title={METRIC_TITLES.utilization}
          sub={utilization.sub}
          option={utilization.option}
          note={utilization.note}
          empty={utilization.empty}
          caption={METRIC_CAPTIONS.utilization}
        />
        <ChartCard
          evidenceId="kv-cache"
          idx="b"
          title={METRIC_TITLES.kv}
          sub={kv.sub}
          option={kv.option}
          note={kv.note}
          empty={kv.empty}
          caption={METRIC_CAPTIONS.kv}
        />
      </Box>
      {workerKey && <WorkerBatchComposition workerKey={workerKey} />}
      {workerKey && <WorkerRequestStateCard workerKey={workerKey} />}
      {workerKey && <WorkerKernelPositionBreakdownCard workerKey={workerKey} />}
    </Stack>
  );
}

function ReadyWorkerStage() {
  const treeState = useActiveWorkerTreeState();
  if (treeState.status !== 'ready') return null;
  return (
    <Box
      data-testid="worker-exact-workbench"
      sx={{
        minWidth: 0,
        height: { xs: 'auto', lg: '100%' },
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0,1fr)',
          lg: 'minmax(0,1fr) clamp(300px,26vw,340px)',
        },
        alignItems: 'stretch',
        gap: 2,
      }}
    >
      <CostTreeFlow />
      <KernelInspectorPlaceholder />
      <KernelInspector height={WORKER_WORKBENCH_HEIGHT} />
    </Box>
  );
}

function ReadyWorkerSupplementary() {
  return (
    <Stack spacing={2}>
      <KernelEvidence />
      <ParallelDetail />
      <TimeShareBlocks />
    </Stack>
  );
}

function KernelInspectorPlaceholder() {
  const scope = useViz((state) => state.scope);
  const wideWorkbench = useMediaQuery('(min-width:1200px)', { noSsr: true });
  if (scope === 'kernel' || !wideWorkbench) return null;
  return (
    <Paper
      data-testid="kernel-inspector-placeholder"
      sx={{
        display: 'flex',
        height: WORKER_WORKBENCH_HEIGHT,
        boxSizing: 'border-box',
        alignItems: 'flex-start',
        p: '14px 15px',
        borderRadius: 2,
        background: tokens.tile2,
      }}
    >
      <Box>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          Kernel inspector
        </Typography>
        <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 10, color: tokens.sub }}>
          Select a kernel in the CostTree to inspect exact execution facts.
        </Typography>
      </Box>
    </Paper>
  );
}

type NonReadyWorkerTreeState = Extract<ActiveWorkerTreeState, { status: WorkerTreeNonReadyStatus }>;

function nonReadyTitle(state: NonReadyWorkerTreeState): string {
  if (state.status === 'failed') return 'Could not load exact worker CostTree detail';
  const titles: Record<Exclude<WorkerTreeNonReadyStatus, 'failed'>, string> = {
    empty: 'Exact worker CostTree is empty',
    unavailable: 'Exact worker CostTree unavailable',
    not_generated: 'Exact worker CostTree not generated',
    incompatible: 'Exact worker CostTree is incompatible',
  };
  return titles[state.status];
}

function NonReadyWorkerStage({ state }: { state: NonReadyWorkerTreeState }) {
  const failed = state.status === 'failed';
  return (
    <CostTreeFrame worker={state.worker}>
      <CostTreeStatusViewport role={failed ? 'alert' : 'status'}>
        <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
          {nonReadyTitle(state)}
        </Typography>
        <Typography
          sx={{
            mt: 0.5,
            fontFamily: tokens.mono,
            fontSize: 11,
            color: tokens.sub,
            lineHeight: 1.6,
          }}
        >
          {state.reason}
        </Typography>
        <Typography sx={{ mt: 1, fontFamily: tokens.mono, fontSize: 9.5, color: tokens.sub2 }}>
          evidence status · {state.status}
          {state.code ? ` · ${state.code}` : ''}
        </Typography>
        {state.retry && (
          <Button size="small" onClick={state.retry} sx={{ mt: 1.5 }}>
            Retry worker detail
          </Button>
        )}
      </CostTreeStatusViewport>
    </CostTreeFrame>
  );
}

function sameOperation(left: OperationRef, right: OperationRef): boolean {
  return (
    left.iterId === right.iterId &&
    left.batchId === right.batchId &&
    left.operationId === right.operationId
  );
}

function pageScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function shellScrollBlock(shell: HTMLElement): ScrollLogicalPosition {
  const renderedHeight = Math.max(shell.getBoundingClientRect().height, shell.scrollHeight);
  return renderedHeight <= window.innerHeight ? 'center' : 'start';
}

function shellIsFullyVisible(shell: HTMLElement): boolean {
  const bounds = shell.getBoundingClientRect();
  return bounds.height > 0 && bounds.top >= 0 && bounds.bottom <= window.innerHeight;
}

function IterationWorkerStage() {
  const state = useActiveWorkerTreeState();
  const selectedOperation = useViz((viz) => viz.operation);
  const scope = useViz((viz) => viz.scope);
  const selectedLeafId = useViz((viz) => viz.leafId);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledTreeRef = useRef<string | null>(null);
  const lastScrolledKernelRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedOperation === null) {
      lastScrolledTreeRef.current = null;
      return;
    }
    // The ready payload carries its exact identity. This prevents a retained
    // old tree from causing an early page jump while a new selection loads.
    if (state.status !== 'ready' || !sameOperation(state.operation, selectedOperation)) return;
    const readyIdentity = `${state.worker.key}/${state.operation.iterId}/${state.operation.batchId}/${state.operation.operationId}`;
    if (lastScrolledTreeRef.current === readyIdentity) return;
    const shell = stageRef.current?.querySelector<HTMLElement>(
      '[data-testid="worker-viewport-shell"]',
    );
    if (shell === null || shell === undefined) return;
    shell.scrollIntoView({
      behavior: pageScrollBehavior(),
      block: shellScrollBlock(shell),
      inline: 'nearest',
    });
    lastScrolledTreeRef.current = readyIdentity;
  }, [selectedOperation, state]);
  useEffect(() => {
    if (scope !== 'kernel' || selectedLeafId === null) {
      lastScrolledKernelRef.current = null;
      return;
    }
    if (state.status !== 'ready' || leafById(state.tree, selectedLeafId) === null) return;
    const selectedIdentity = `${state.worker.key}/${state.operation.iterId}/${state.operation.batchId}/${state.operation.operationId}/${selectedLeafId}`;
    if (lastScrolledKernelRef.current === selectedIdentity) return;
    const shell = stageRef.current?.querySelector<HTMLElement>(
      '[data-testid="worker-viewport-shell"]',
    );
    if (shell === null || shell === undefined) return;
    if (!shellIsFullyVisible(shell)) {
      shell.scrollIntoView({
        behavior: pageScrollBehavior(),
        block: shellScrollBlock(shell),
        inline: 'nearest',
      });
    }
    lastScrolledKernelRef.current = selectedIdentity;
  }, [scope, selectedLeafId, state]);
  let content;
  if (state.status === 'loading' || state.status === 'idle') {
    const worker = state.status === 'loading' ? state.worker.key : 'selected worker';
    content = (
      <CostTreeFrame worker={state.status === 'loading' ? state.worker : null}>
        <CostTreeStatusViewport role="status" busy>
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Loading exact worker CostTree detail
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
            Loading evidence for {worker}…
          </Typography>
        </CostTreeStatusViewport>
      </CostTreeFrame>
    );
  } else if (state.status === 'awaiting-selection') {
    content = (
      <CostTreeFrame worker={state.worker}>
        <CostTreeStatusViewport role="status">
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Select an exact operation
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
            CostTree detail is requested only after an exact iter, batch/slot, and operation are
            selected.
          </Typography>
        </CostTreeStatusViewport>
      </CostTreeFrame>
    );
  } else if (state.status === 'error') {
    content = (
      <CostTreeFrame worker={state.worker}>
        <CostTreeStatusViewport role="alert">
          <Typography sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 16 }}>
            Invalid worker selection
          </Typography>
          <Typography sx={{ mt: 0.5, fontFamily: tokens.mono, fontSize: 11, color: tokens.sub }}>
            {state.error.message}
          </Typography>
        </CostTreeStatusViewport>
      </CostTreeFrame>
    );
  } else if (state.status !== 'ready') {
    content = <NonReadyWorkerStage state={state} />;
  } else {
    content = <ReadyWorkerStage />;
  }
  return (
    <Stack ref={stageRef} spacing={2}>
      <Box
        data-testid="worker-viewport-shell"
        sx={{
          [WORKER_VIEWPORT_HEIGHT_VAR]: `calc(100dvh - ${WORKER_VIEWPORT_SAFE_GAP}px)`,
          [WORKER_WORKBENCH_MIN_HEIGHT_VAR]: `${WORKER_WORKBENCH_MIN_HEIGHT}px`,
          [WORKER_WORKBENCH_MAX_HEIGHT_VAR]: `${COST_TREE_FRAME_HEIGHT}px`,
          [WORKER_WORKBENCH_HEIGHT_VAR]: {
            xs: `${COST_TREE_FRAME_HEIGHT}px`,
            lg: '100%',
          },
          minWidth: 0,
          display: 'grid',
          gridTemplateRows: {
            xs: 'auto auto',
            lg: `max-content minmax(var(${WORKER_WORKBENCH_MIN_HEIGHT_VAR}), var(${WORKER_WORKBENCH_MAX_HEIGHT_VAR}))`,
          },
          gap: 2,
          height: {
            xs: 'auto',
            lg: `var(${WORKER_VIEWPORT_HEIGHT_VAR})`,
          },
          alignContent: { lg: 'center' },
        }}
      >
        <Box data-testid="worker-operation-row" sx={{ minWidth: 0, minHeight: 'max-content' }}>
          <WorkerOperationTimeline />
        </Box>
        <Box
          data-testid="worker-workbench-row"
          sx={{ minWidth: 0, minHeight: 0, height: { xs: 'auto', lg: '100%' } }}
        >
          {content}
        </Box>
      </Box>
      {state.status === 'ready' && <ReadyWorkerSupplementary />}
    </Stack>
  );
}

export default function WorkerStage() {
  const analysisLevel = useViz((state) => state.workerAnalysisLevel);
  return analysisLevel === 'worker' ? <WorkerAggregateStage /> : <IterationWorkerStage />;
}
