/**
 * Exact worker operations at a location.
 *
 * The visual is the former WorkerOperationTimeline moved intact into this
 * panel. This file only translates the URL-shaped Location and the sequence
 * read into that visual's state. Exact selection is committed back to the
 * Location, so a reload or citation names the same operation.
 */
import { useEffect, useMemo } from 'react';
import { Box, Stack } from '@mui/material';

import {
  operationsSeqRef,
  runDescriptorRef,
  useArtifact,
  useSequenceWindow,
  type ArtifactResult,
  type OperationSummary,
  type RunResultRef,
} from '../../artifacts';
import { segmentOf, selectSegment, upTo, withCursor, withPanel } from '../../location';
import AnalysisSection from '../../ui/controls/AnalysisSection';
import { WorkerAnalysisLevelToggle } from '../../ui/controls/WorkerAnalysisLevelToggle';
import { tokens } from '../../ui/theme';
import { workerOf } from '../coordinate';
import type { PanelProps } from '../types';
import OperationTimelineView, {
  type OperationTimelineSeekState,
  type OperationTimelineState,
} from './OperationTimelineView';
import { CostTreeSupplementary, CostTreeWorkbench, WorkerViewport } from './CostTreeWorkbench';

function operationMatches(
  operation: OperationSummary,
  selected: ReturnType<typeof selectedOperation>,
): boolean {
  return (
    selected !== null &&
    operation.ref.iterId === selected.iter &&
    operation.ref.batchId === selected.batch &&
    operation.ref.operationId === selected.op
  );
}

function selectedOperation(location: PanelProps['location']) {
  return segmentOf(location.focus.path, 'operation');
}

function readReason(
  result: Exclude<ArtifactResult<unknown>, { status: 'pending' | 'ready' }>,
): string {
  switch (result.status) {
    case 'unavailable':
      return result.reason;
    case 'not_generated':
      return result.reason ?? 'Worker operation index was not generated.';
    case 'failed':
      return result.reason;
    case 'incompatible':
      return result.reason;
  }
}

function workerKey(poolTag: string, workerId: string): string {
  return `${poolTag}/${workerId}`;
}

type RunPanelProps = Omit<PanelProps, 'location'> & {
  readonly location: PanelProps['location'] & { readonly ref: RunResultRef };
};

export function WorkerWorkbenchPanel(props: PanelProps) {
  if (props.location.ref.kind !== 'run') return null;
  return (
    <RunWorkerWorkbenchPanel {...props} location={props.location as RunPanelProps['location']} />
  );
}

function RunWorkerWorkbenchPanel({ location, navigate }: RunPanelProps) {
  const descriptor = useArtifact(useMemo(() => runDescriptorRef(location.ref), [location.ref]));
  const worker = useMemo(() => workerOf(location.focus), [location.focus]);
  const detail =
    descriptor.status === 'ready' ? descriptor.value.details['worker-operation-index'] : undefined;
  const analysisRevision =
    descriptor.status === 'ready' ? descriptor.value.analysis?.revision : undefined;
  const selected = selectedOperation(location);
  const sequence = useMemo(() => {
    if (
      descriptor.status !== 'ready' ||
      detail?.status !== 'ready' ||
      analysisRevision === undefined ||
      worker === null
    ) {
      return null;
    }
    return operationsSeqRef(
      { ...location.ref, kind: 'run', revision: analysisRevision },
      location.focus.path,
    );
  }, [
    analysisRevision,
    descriptor.status,
    detail?.status,
    location.focus.path,
    location.ref,
    worker,
  ]);
  const request = useMemo(
    () =>
      selected !== null || location.focus.cursorMs === null
        ? ({ mode: 'start' } as const)
        : ({ mode: 'seek', atMs: location.focus.cursorMs } as const),
    [location.focus.cursorMs, selected],
  );
  const controller = useSequenceWindow(sequence, sequence === null ? null : request);
  const window = controller.result.status === 'ready' ? controller.result.value : null;

  useEffect(() => {
    if (
      selected !== null ||
      location.focus.cursorMs === null ||
      window?.seek === null ||
      window?.seek.atMs !== location.focus.cursorMs
    ) {
      return;
    }
    const anchor = window.seek.buffer.operations.find(
      (operation) => operation.ordinal === window.seek?.anchor.ordinal,
    );
    if (anchor === undefined) return;
    const focus = withCursor(
      selectSegment(location.focus, {
        at: 'operation',
        iter: anchor.ref.iterId,
        batch: anchor.ref.batchId,
        op: anchor.ref.operationId,
      }),
      location.focus.cursorMs,
    );
    navigate({ ...location, focus }, 'replace');
  }, [location, navigate, selected, window]);

  const presentWorker = {
    key: worker === null ? 'invalid selection' : workerKey(worker.poolTag, worker.workerId),
  };
  let state: OperationTimelineState;
  if (worker === null) {
    state = {
      status: 'error',
      worker: null,
      reason: 'This address does not name a worker.',
    };
  } else if (descriptor.status === 'pending' || detail?.status === 'pending') {
    state = { status: 'loading', worker: presentWorker };
  } else if (descriptor.status !== 'ready') {
    state = { status: descriptor.status, worker: presentWorker, reason: readReason(descriptor) };
  } else if (detail === undefined) {
    state = {
      status: 'not_generated',
      worker: presentWorker,
      reason: 'Run descriptor does not provide ready worker-operation-index.',
    };
  } else if (detail.status !== 'ready') {
    state = {
      status: detail.status,
      worker: presentWorker,
      reason:
        'reason' in detail && detail.reason
          ? detail.reason
          : 'Run descriptor does not provide ready worker-operation-index.',
    };
  } else if (analysisRevision === undefined) {
    state = {
      status: 'incompatible',
      worker: presentWorker,
      reason: 'Ready worker operations require the descriptor analysis revision.',
    };
  } else if (controller.result.status === 'pending') {
    state = { status: 'loading', worker: presentWorker };
  } else if (controller.result.status !== 'ready') {
    state = {
      status: controller.result.status,
      worker: presentWorker,
      reason: readReason(controller.result),
    };
  } else {
    const value = controller.result.value;
    state = {
      status: 'ready',
      worker: presentWorker,
      viewport: value.viewport,
      operations: value.operations,
      selected:
        value.viewport.buffer.operations.find((operation) =>
          operationMatches(operation, selected),
        ) ?? null,
      shift: controller.shift,
      navigate: controller.move,
    };
  }

  let seek: OperationTimelineSeekState = { status: 'idle', atMs: null };
  if (location.focus.cursorMs !== null && window !== null) {
    if (window.refreshing) {
      seek = { status: 'loading', atMs: location.focus.cursorMs };
    } else if (window.refreshProblem !== null) {
      seek = {
        status: 'error',
        atMs: location.focus.cursorMs,
        reason: readReason(window.refreshProblem),
      };
    } else if (window.seek?.atMs === location.focus.cursorMs) {
      seek = { status: 'ready', atMs: location.focus.cursorMs };
    }
  }

  const select = (operation: OperationSummary) => {
    const focus = withCursor(
      selectSegment(location.focus, {
        at: 'operation',
        iter: operation.ref.iterId,
        batch: operation.ref.batchId,
        op: operation.ref.operationId,
      }),
      operation.startMs,
    );
    navigate({ ...location, focus }, 'push');
  };

  const costTreeReady =
    descriptor.status === 'ready' &&
    descriptor.value.details['worker-cost-tree']?.status === 'ready';
  const showWorker = () => {
    const focus = withPanel(upTo(location.focus, 'worker'), null);
    navigate({ ...location, focus }, 'push');
  };

  return (
    <AnalysisSection
      idx="02"
      title={`Worker · ${presentWorker.key}`}
      sub={
        costTreeReady
          ? 'exact operation CostTree · worker operation timeline'
          : 'exact worker detail not generated'
      }
      accent={tokens.sectionAnalysis}
      controls={
        <WorkerAnalysisLevelToggle
          level="iteration"
          onChange={(level) => level === 'worker' && showWorker()}
        />
      }
    >
      <Stack spacing={2}>
        <WorkerViewport>
          <Box data-testid="worker-operation-row" sx={{ minWidth: 0, minHeight: 'max-content' }}>
            <OperationTimelineView state={state} seek={seek} selectOperation={select} />
          </Box>
          <CostTreeWorkbench location={location} navigate={navigate} descriptor={descriptor} />
        </WorkerViewport>
        <CostTreeSupplementary location={location} navigate={navigate} descriptor={descriptor} />
      </Stack>
    </AnalysisSection>
  );
}
