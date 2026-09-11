import { withOption, type Navigate } from '../location';
import type { ChartEvidenceSelection } from '../ui/controls/ChartCard';
import type { PanelProps } from './types';

export const EVIDENCE_PANEL_OPTION = 'evidence-panel';

/** Keep evidence selection independent from `focus.panel`, which controls
 * whether the result renders a complete layout or one standalone panel. */
export function evidenceSelection(
  location: PanelProps['location'],
  navigate: Navigate,
  evidenceId: string,
): ChartEvidenceSelection {
  return {
    evidenceId,
    selectedForAgent: location.focus.options[EVIDENCE_PANEL_OPTION] === evidenceId,
    onEvidenceSelect: () =>
      navigate(
        {
          ...location,
          focus: withOption(location.focus, EVIDENCE_PANEL_OPTION, evidenceId),
        },
        'replace',
      ),
  };
}
