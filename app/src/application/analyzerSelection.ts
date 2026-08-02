import {
  analyzerSelectionChangeV2Schema,
  type AnalyzerSelectionChangeV2,
  type AnalyzerSelectionV2,
  type InquiryContextV2,
} from '../domain/analyzerSelection';
import type { AppView } from './appRoute';
import { useViz, type VizState } from '../store';

export const ANALYZER_SELECTION_CHANGE_EVENT = 'vibesim:analyzer-selection-change';

/** Projects the store into the literal context understood by Prototype B.
 * Actions and panel geometry never cross this boundary. */
export function analyzerSelectionFromVizState(state: VizState): AnalyzerSelectionV2 | null {
  if (state.selectionSurface === 'aggregate') return state.aggregateSelection;
  if (state.selectionSurface === 'prediction') return state.predictionSelection;
  if (state.selectionSurface === 'kernel_profile') return state.kernelProfileSelection;
  if (state.selectionSurface === 'kernel_measurement') return state.kernelMeasurementSelection;
  if (state.runWorkspaceId === null || state.runId === null) return null;
  return {
    kind: 'run',
    workspaceId: state.runWorkspaceId,
    runId: state.runId,
    panelId: state.runPanelId,
    scope: state.scope,
    poolRole: state.poolRole,
    workerKey: state.workerKey,
    leafId: state.leafId,
    parId: state.parId,
    cursorMs: state.cursorMs,
    cursorNeedsSeek: state.cursorNeedsSeek,
    operation: state.operation,
    workerAnalysisLevel: state.workerAnalysisLevel,
  };
}

/** Keep retained back-navigation state separate from the evidence attachment
 * owned by the page that is actually visible. */
export function analyzerSelectionForView(
  view: AppView,
  selection: AnalyzerSelectionV2 | null,
): AnalyzerSelectionV2 | null {
  if (view === 'aggregate') return selection?.kind === 'aggregate' ? selection : null;
  if (view === 'run') return selection?.kind === 'run' ? selection : null;
  if (view === 'prediction') return selection?.kind === 'prediction' ? selection : null;
  if (view === 'kernel-profile') {
    return selection?.kind === 'kernel_profile' ? selection : null;
  }
  if (view === 'kernel-measurement') {
    return selection?.kind === 'kernel_measurement' ? selection : null;
  }
  return null;
}

export function inquiryContextFromVizState(state: VizState): InquiryContextV2 | null {
  const selection = analyzerSelectionFromVizState(state);
  if (selection === null || state.inquiryId === null || state.phaseId === null) return null;
  return {
    protocol: 'vibesim.inquiry-context/v2',
    inquiryId: state.inquiryId,
    phaseId: state.phaseId,
    selection,
  };
}

function selectionChangeMessage(
  state: VizState,
  revision: number,
): AnalyzerSelectionChangeV2 | null {
  const selection = analyzerSelectionFromVizState(state);
  if (selection === null) return null;
  const context = inquiryContextFromVizState(state);
  return analyzerSelectionChangeV2Schema.parse({
    protocol: 'vibesim.analyzer/v2',
    type: 'selection-change',
    revision,
    selection,
    ...(context ? { context } : {}),
  });
}

/** Publishes selection changes for an iframe or external Agent shell. The
 * in-app Inquiry rail should subscribe to useViz directly; this transport is
 * only the process/window boundary and is intentionally notification-only. */
export function installAnalyzerSelectionPublisher(): () => void {
  let revision = 0;
  let previousIdentity: string | null = null;

  const publish = (state: VizState) => {
    const selection = analyzerSelectionFromVizState(state);
    const context = inquiryContextFromVizState(state);
    const identity = JSON.stringify({ selection, context });
    if (selection === null || identity === previousIdentity) return;
    previousIdentity = identity;
    const message = selectionChangeMessage(state, (revision += 1));
    if (message === null) return;
    window.dispatchEvent(new CustomEvent(ANALYZER_SELECTION_CHANGE_EVENT, { detail: message }));
    window.postMessage(message, window.location.origin);
    if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
  };

  publish(useViz.getState());
  return useViz.subscribe(publish);
}
