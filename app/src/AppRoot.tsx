import App from './App';
import { ChartFocusProvider } from './components/ChartFocusProvider';
import { useViz } from './store';
import { lazy, Suspense, useEffect, useState } from 'react';

const SweepPage = lazy(() =>
  import('./features/sweep').then((feature) => ({ default: feature.SweepPage })),
);

function currentView(): 'run' | 'aggregate' {
  return window.location.hash === '#/run' ? 'run' : 'aggregate';
}

/** Connects app navigation identity to otherwise-local chart focus state. */
export default function AppRoot() {
  const runId = useViz((state) => state.runId);
  const [view, setView] = useState(currentView);
  useEffect(() => {
    if (window.location.hash !== '#/run' && window.location.hash !== '#/aggregate') {
      window.history.replaceState(null, '', '#/aggregate');
    }
    const updateView = () => setView(currentView());
    window.addEventListener('hashchange', updateView);
    return () => window.removeEventListener('hashchange', updateView);
  }, []);
  return (
    <Suspense fallback={null}>
      {view === 'aggregate' ? (
        <SweepPage />
      ) : (
        <ChartFocusProvider resetKey={runId}>
          <App />
        </ChartFocusProvider>
      )}
    </Suspense>
  );
}
