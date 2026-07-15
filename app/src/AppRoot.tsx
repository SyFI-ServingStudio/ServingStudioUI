import App from './App';
import { ChartFocusProvider } from './components/ChartFocusProvider';
import { useViz } from './store';

/** Connects app navigation identity to otherwise-local chart focus state. */
export default function AppRoot() {
  const runId = useViz((state) => state.runId);
  return (
    <ChartFocusProvider resetKey={runId}>
      <App />
    </ChartFocusProvider>
  );
}
