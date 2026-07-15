import type { EChartsOption } from 'echarts';
import { createContext, useContext } from 'react';

export interface ChartFocusPayload {
  title: string;
  caption: string;
  option: EChartsOption;
}

export interface ChartFocusActions {
  openFocus: (payload: ChartFocusPayload) => void;
  closeFocus: () => void;
}

export const ChartFocusActionsContext = createContext<ChartFocusActions | null>(null);
export const ChartFocusStateContext = createContext<ChartFocusPayload | null | undefined>(
  undefined,
);

function useChartFocusActions(): ChartFocusActions {
  const actions = useContext(ChartFocusActionsContext);
  if (actions === null) throw new Error('ChartFocusProvider is missing from the application root.');
  return actions;
}

/** Stable action-only subscription used by every chart tile. */
export function useOpenChartFocus(): ChartFocusActions['openFocus'] {
  return useChartFocusActions().openFocus;
}

/** State subscription reserved for the one shared focus dialog. */
export function useChartFocusDialog(): {
  focus: ChartFocusPayload | null;
  closeFocus: ChartFocusActions['closeFocus'];
} {
  const { closeFocus } = useChartFocusActions();
  const focus = useContext(ChartFocusStateContext);
  if (focus === undefined)
    throw new Error('ChartFocusProvider is missing from the application root.');
  return { focus, closeFocus };
}
