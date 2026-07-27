import type { SweepAnalysis } from '../../domain/sweep';
import { sweepMetricSections } from '../sweep/metricSections';

export function firstThroughputEvidence(analysis: SweepAnalysis | undefined):
  | {
      panelId: string;
      metricKey: string;
    }
  | undefined {
  const panel = sweepMetricSections(analysis?.metrics ?? []).find(
    (section) => section.id === 'throughput',
  )?.panels[0];
  const metric = panel?.metrics[0];
  if (!panel || !metric) return undefined;
  return { panelId: panel.id, metricKey: metric.key };
}
