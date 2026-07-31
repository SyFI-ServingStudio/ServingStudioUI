import App from './App';
import { installAnalyzerSelectionPublisher } from './application/analyzerSelection';
import { appViewFromHash } from './application/appRoute';
import { ChartFocusProvider } from './components/ChartFocusProvider';
import {
  ANALYZER_NAVIGATION_RESULT_EVENT,
  analyzerEvidenceHref,
  analyzerNavigateCommandV2Schema,
  evidenceRefFromHash,
  navigationResult,
} from './domain/analyzerNavigation';
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
    if (view === 'aggregate' || view === 'run') setSelectionSurface(view);
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
      if (evidence?.kind === 'run') useViz.getState().restoreRunSelection(evidence);
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
      if (parsed.data.target.kind === 'run') {
        useViz.getState().restoreRunSelection(parsed.data.target);
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
  else {
    content = (
      <ChartFocusProvider resetKey={runId}>
        <App />
      </ChartFocusProvider>
    );
  }
  return (
    <Suspense fallback={null}>
      {view === 'entry' ? content : <WorkspaceShell view={view}>{content}</WorkspaceShell>}
    </Suspense>
  );
}
