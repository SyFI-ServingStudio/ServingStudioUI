import {
  analyzerSelectionChangeV1Schema,
  type AnalyzerSelectionChangeV1,
  type AnalyzerSelectionV1,
  type InquiryContextV1,
} from '../domain/analyzerSelection';
import { useViz, type VizState } from '../store';

export const ANALYZER_SELECTION_CHANGE_EVENT = 'vibesim:analyzer-selection-change';

/** Projects the store into the literal context understood by Prototype B.
 * Actions and panel geometry never cross this boundary. */
export function analyzerSelectionFromVizState(state: VizState): AnalyzerSelectionV1 | null {
  if (state.selectionSurface === 'aggregate') return state.aggregateSelection;
  if (state.runId === null) return null;
  return {
    kind: 'run',
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

export function inquiryContextFromVizState(state: VizState): InquiryContextV1 | null {
  const selection = analyzerSelectionFromVizState(state);
  if (selection === null || state.inquiryId === null || state.phaseId === null) return null;
  return {
    protocol: 'vibesim.inquiry-context/v1',
    inquiryId: state.inquiryId,
    phaseId: state.phaseId,
    selection,
  };
}

function selectionChangeMessage(
  state: VizState,
  revision: number,
): AnalyzerSelectionChangeV1 | null {
  const selection = analyzerSelectionFromVizState(state);
  if (selection === null) return null;
  const context = inquiryContextFromVizState(state);
  return analyzerSelectionChangeV1Schema.parse({
    protocol: 'vibesim.analyzer/v1',
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
