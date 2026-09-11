import { useLocation, type Location } from '../location';
import { ChartFocusProvider } from '../ui/controls/ChartFocusProvider';
import FocusDialog from '../ui/controls/FocusDialog';
import { LocatedApp } from './App';

/** Root for ephemeral UI state whose lifetime follows the addressed result. */
export function ApplicationRoot() {
  const location = useLocation();
  return (
    <ChartFocusProvider resetKey={chartFocusResetKey(location)}>
      <LocatedApp location={location} />
      <FocusDialog />
    </ChartFocusProvider>
  );
}

function chartFocusResetKey(location: Location | null): string | null {
  if (location === null) return null;
  if (location.view !== 'result') return location.view;
  const { kind, workspace, id, revision } = location.ref;
  return `result:${kind}:${workspace}:${id}:${revision ?? ''}`;
}
