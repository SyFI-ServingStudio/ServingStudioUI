import { createContext, useContext } from 'react';

import type { ChartEvidenceSelection } from './ChartCard';

export type ChartEvidenceResolver = (evidenceId: string) => ChartEvidenceSelection;
export const ChartEvidenceContext = createContext<ChartEvidenceResolver | null>(null);

export function useChartEvidenceSelection(
  evidenceId: string | undefined,
): ChartEvidenceSelection | undefined {
  const resolve = useContext(ChartEvidenceContext);
  return evidenceId === undefined || resolve === null ? undefined : resolve(evidenceId);
}
