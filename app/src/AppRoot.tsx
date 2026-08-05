import App from './App';
import { installAnalyzerSelectionPublisher } from './application/analyzerSelection';
import {
  alignmentIdFromHash,
  appViewFromHash,
  kernelMeasurementIdFromHash,
  kernelProfileIdFromHash,
  predictionIdFromHash,
} from './application/appRoute';
import { ChartFocusProvider } from './components/ChartFocusProvider';
import FocusDialog from './components/FocusDialog';
import {
  ANALYZER_NAVIGATION_RESULT_EVENT,
  analyzerEvidenceHref,
  analyzerNavigateCommandV2Schema,
  evidenceRefFromHash,
  navigationResult,
} from './domain/analyzerNavigation';
import { analyzerSelectionFromEvidenceRef } from './domain/evidenceRef';
import { fileRefFromHash } from './domain/workspaceFile';
import { useViz } from './store';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const SweepPage = lazy(() =>
  import('./features/sweep').then((feature) => ({ default: feature.SweepPage })),
);
const EntryPage = lazy(() =>
  import('./features/workspace').then((feature) => ({ default: feature.EntryPage })),
);
const WorkspaceShell = lazy(() =>
  import('./features/workspace').then((feature) => ({ default: feature.WorkspaceShell })),
);
const KernelProfilePage = lazy(() =>
  import('./features/kernel-profile').then((feature) => ({ default: feature.KernelProfilePage })),
);
const KernelMeasurementPage = lazy(() =>
  import('./features/kernel-measurement').then((feature) => ({
    default: feature.KernelMeasurementPage,
  })),
);
const PredictionPage = lazy(() =>
  import('./features/prediction').then((feature) => ({ default: feature.PredictionPage })),
);
const AlignmentPage = lazy(() =>
  import('./features/alignment').then((feature) => ({ default: feature.AlignmentPage })),
);
const FilePreviewPage = lazy(() =>
  import('./features/file').then((feature) => ({ default: feature.FilePreviewPage })),
);

/** Connects app navigation identity to otherwise-local chart focus state. */
export default function AppRoot() {
  const runId = useViz((state) => state.runId);
  const setSelectionSurface = useViz((state) => state.setSelectionSurface);
  // The query portion carries workspace and evidence identity. Tracking only
  // the coarse view would leave same-view navigation rendered against the
  // previous workspace even though the address bar had already changed.
  const [locationHash, setLocationHash] = useState(() => window.location.hash);
  const view = appViewFromHash(locationHash);
  const pendingNavigationResponses = useRef(
    new Map<string, { source: WindowProxy; origin: string; href: string }>(),
  );
  useEffect(() => {
    if (view === 'aggregate' || view === 'run' || view === 'prediction') setSelectionSurface(view);
    if (view === 'kernel-profile') setSelectionSurface('kernel_profile');
    if (view === 'kernel-measurement') setSelectionSurface('kernel_measurement');
  }, [setSelectionSurface, view]);
  useEffect(() => installAnalyzerSelectionPublisher(), []);
  useEffect(() => {
    if (!window.location.hash) {
      const destination = new URL(window.location.href);
      destination.hash = '#/';
      window.history.replaceState(null, '', destination);
    }
    const updateView = () => {
      const evidence = evidenceRefFromHash(window.location.hash);
      const selection = evidence ? analyzerSelectionFromEvidenceRef(evidence) : null;
      if (selection?.kind === 'run') useViz.getState().restoreRunSelection(selection);
      if (selection?.kind === 'prediction') {
        useViz.getState().restorePredictionSelection(selection);
      }
      if (selection?.kind === 'kernel_profile') {
        useViz.getState().restoreKernelProfileSelection(selection);
      }
      if (selection?.kind === 'kernel_measurement') {
        useViz.getState().restoreKernelMeasurementSelection(selection);
      }
      setLocationHash(window.location.hash);
    };
    const receiveAgentNavigation = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || event.source === null) return;
      const parsed = analyzerNavigateCommandV2Schema.safeParse(event.data);
      if (!parsed.success) return;
      pendingNavigationResponses.current.set(parsed.data.requestId, {
        source: event.source as WindowProxy,
        origin: event.origin,
        href: analyzerEvidenceHref(parsed.data.target),
      });
      const selection = analyzerSelectionFromEvidenceRef(parsed.data.target);
      if (selection.kind === 'run') {
        useViz.getState().restoreRunSelection(selection);
      }
      if (selection.kind === 'prediction') {
        useViz.getState().restorePredictionSelection(selection);
      }
      if (selection.kind === 'kernel_profile') {
        useViz.getState().restoreKernelProfileSelection(selection);
      }
      if (selection.kind === 'kernel_measurement') {
        useViz.getState().restoreKernelMeasurementSelection(selection);
      }
      const href = analyzerEvidenceHref(parsed.data.target);
      if (window.location.hash === href) {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      } else {
        window.location.hash = href;
      }
    };
    updateView();
    const returnNavigationResult = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          href: string;
          status: 'ok' | 'not-found' | 'unavailable';
        }>
      ).detail;
      pendingNavigationResponses.current.forEach((pending, requestId) => {
        if (pending.href !== detail.href) return;
        pending.source.postMessage(navigationResult(requestId, detail.status), pending.origin);
        pendingNavigationResponses.current.delete(requestId);
      });
    };
    window.addEventListener('hashchange', updateView);
    window.addEventListener('message', receiveAgentNavigation);
    window.addEventListener(ANALYZER_NAVIGATION_RESULT_EVENT, returnNavigationResult);
    return () => {
      window.removeEventListener('hashchange', updateView);
      window.removeEventListener('message', receiveAgentNavigation);
      window.removeEventListener(ANALYZER_NAVIGATION_RESULT_EVENT, returnNavigationResult);
    };
  }, []);
  let content;
  if (view === 'entry') content = <EntryPage />;
  else if (view === 'agent') content = null;
  else if (view === 'aggregate') content = <SweepPage integrated />;
  else if (view === 'prediction') {
    const predictionId = predictionIdFromHash(locationHash);
    content = predictionId === null ? null : <PredictionPage predictionId={predictionId} />;
  } else if (view === 'alignment') {
    const alignmentId = alignmentIdFromHash(locationHash);
    content = alignmentId === null ? null : <AlignmentPage alignmentId={alignmentId} />;
  } else if (view === 'kernel-profile') {
    const profileId = kernelProfileIdFromHash(locationHash);
    content = profileId === null ? null : <KernelProfilePage profileId={profileId} />;
  } else if (view === 'kernel-measurement') {
    const measurementId = kernelMeasurementIdFromHash(locationHash);
    content =
      measurementId === null ? null : <KernelMeasurementPage measurementId={measurementId} />;
  } else if (view === 'file') {
    const fileRef = fileRefFromHash(locationHash);
    content = fileRef === null ? null : <FilePreviewPage fileRef={fileRef} />;
  } else content = <App />;
  // Chart cards are shared by all Analyzer surfaces. Their
  // provider and single dialog therefore belong to the route root rather than
  // the legacy run page. A route/resource change invalidates an open snapshot.
  const chartFocusResetKey = view === 'run' ? `run:${runId ?? ''}` : locationHash;
  return (
    <ChartFocusProvider resetKey={chartFocusResetKey}>
      {view === 'entry' ? (
        <Suspense fallback={null}>{content}</Suspense>
      ) : (
        <Suspense fallback={null}>
          <WorkspaceShell view={view}>
            {/* A first visit may suspend while its Analyzer feature chunk loads.
                Keep that boundary inside the persistent workspace shell so the
                Agent conversation, draft, scroll, and panel transition never
                disappear with the route content. */}
            <Suspense fallback={null}>{content}</Suspense>
          </WorkspaceShell>
        </Suspense>
      )}
      <FocusDialog />
    </ChartFocusProvider>
  );
}
