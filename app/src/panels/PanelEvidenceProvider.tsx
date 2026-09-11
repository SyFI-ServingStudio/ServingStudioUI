import { useCallback, type ReactNode } from 'react';

import {
  ChartEvidenceContext,
  type ChartEvidenceResolver,
} from '../ui/controls/ChartEvidenceContext';
import { evidenceSelection } from './evidenceSelection';
import type { PanelProps } from './types';

export function PanelEvidenceProvider({
  location,
  navigate,
  children,
}: PanelProps & { readonly children: ReactNode }) {
  const resolve = useCallback<ChartEvidenceResolver>(
    (evidenceId) => evidenceSelection(location, navigate, evidenceId),
    [location, navigate],
  );
  return <ChartEvidenceContext.Provider value={resolve}>{children}</ChartEvidenceContext.Provider>;
}
