import { useCallback, useMemo, useState, type ReactNode } from 'react';

import {
  ChartFocusActionsContext,
  ChartFocusStateContext,
  type ChartFocusPayload,
} from './ChartFocusContext';

/**
 * Owns the ephemeral expanded-chart snapshot. The action and state contexts
 * are deliberately separate: every chart subscribes only to stable actions,
 * while the single dialog subscribes to the selected option.
 */
export function ChartFocusProvider({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey?: string | null;
}) {
  const [selection, setSelection] = useState<{
    resetKey: string | null | undefined;
    focus: ChartFocusPayload | null;
  }>({ resetKey, focus: null });
  const focus = selection.resetKey === resetKey ? selection.focus : null;
  const openFocus = useCallback(
    (payload: ChartFocusPayload) => setSelection({ resetKey, focus: payload }),
    [resetKey],
  );
  const closeFocus = useCallback(() => setSelection({ resetKey, focus: null }), [resetKey]);
  const actions = useMemo(() => ({ openFocus, closeFocus }), [closeFocus, openFocus]);

  return (
    <ChartFocusActionsContext.Provider value={actions}>
      <ChartFocusStateContext.Provider value={focus}>{children}</ChartFocusStateContext.Provider>
    </ChartFocusActionsContext.Provider>
  );
}
