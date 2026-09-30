import { useLocation } from '../location';
import { ChartFocusProvider } from '../ui/controls/ChartFocusProvider';
import FocusDialog from '../ui/controls/FocusDialog';
import { LocatedApp } from './App';
import { chartFocusResetKey } from './chartFocusKey';

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
