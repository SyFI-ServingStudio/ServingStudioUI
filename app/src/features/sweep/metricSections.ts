import type { SweepMetric } from '../../domain/sweep';

export interface SweepMetricPanel {
  id: string;
  label: string;
  metrics: readonly SweepMetric[];
}

export interface SweepMetricSection {
  id: 'throughput' | 'utilization' | 'request-slo';
  label: string;
  panels: readonly SweepMetricPanel[];
}

function statistic(metric: SweepMetric): 'mean' | 'p99' | null {
  if (/(^|_)mean(_|$)/.test(metric.key) || /^mean\b/i.test(metric.label)) return 'mean';
  if (/(^|_)p99(_|$)/.test(metric.key) || /^p99\b/i.test(metric.label)) return 'p99';
  return null;
}

function panelIdentity(metric: SweepMetric): { id: string; label: string } {
  const metricStatistic = statistic(metric);
  if (metricStatistic === null) return { id: metric.key, label: metric.label };
  return {
    id: metric.group,
    label: metric.label.replace(/^(mean|p99)\s+/i, ''),
  };
}

function sectionId(metric: SweepMetric): SweepMetricSection['id'] {
  if (metric.group === 'utilization' || metric.key.includes('utilization')) return 'utilization';
  if (
    metric.group === 'tpot' ||
    metric.group === 'ttft' ||
    metric.key.includes('tpot') ||
    metric.key.includes('ttft')
  ) {
    return 'request-slo';
  }
  return 'throughput';
}

const SECTION_ORDER: readonly SweepMetricSection['id'][] = [
  'throughput',
  'utilization',
  'request-slo',
];

const SECTION_LABELS: Readonly<Record<SweepMetricSection['id'], string>> = {
  throughput: 'Throughput',
  utilization: 'Utilization',
  'request-slo': 'Request SLO',
};

export function metricStatisticLabel(metric: SweepMetric): 'Mean' | 'P99' | null {
  const metricStatistic = statistic(metric);
  if (metricStatistic === 'mean') return 'Mean';
  if (metricStatistic === 'p99') return 'P99';
  return null;
}

function statisticOrder(metric: SweepMetric): number {
  const label = metricStatisticLabel(metric);
  if (label === 'Mean') return 0;
  if (label === 'P99') return 1;
  return 2;
}

export function sweepMetricSections(
  metrics: readonly SweepMetric[],
): readonly SweepMetricSection[] {
  const sectionPanels = new Map<
    SweepMetricSection['id'],
    Map<string, { label: string; metrics: SweepMetric[] }>
  >();

  metrics.forEach((metric) => {
    const targetSectionId = sectionId(metric);
    const identity = panelIdentity(metric);
    const panels = sectionPanels.get(targetSectionId) ?? new Map();
    const panel = panels.get(identity.id);
    if (panel) panel.metrics.push(metric);
    else panels.set(identity.id, { label: identity.label, metrics: [metric] });
    sectionPanels.set(targetSectionId, panels);
  });

  return SECTION_ORDER.flatMap((id) => {
    const panels = sectionPanels.get(id);
    if (!panels) return [];
    return [
      {
        id,
        label: SECTION_LABELS[id],
        panels: Array.from(panels, ([panelId, panel]) => ({
          id: panelId,
          label: panel.label,
          metrics: panel.metrics.sort(
            (left, right) => statisticOrder(left) - statisticOrder(right),
          ),
        })),
      },
    ];
  });
}
