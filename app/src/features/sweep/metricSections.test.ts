import { describe, expect, it } from 'vitest';

import type { SweepMetric } from '../../domain/sweep';
import { sweepMetricSections } from './metricSections';

const metrics: readonly SweepMetric[] = [
  {
    key: 'tpot_p99_ms',
    label: 'P99 TPOT',
    group: 'tpot',
    unit: 'ms/token',
    objective: 'minimize',
  },
  {
    key: 'total_tps',
    label: 'Total throughput',
    group: 'throughput',
    unit: 'tok/s',
    objective: 'maximize',
  },
  {
    key: 'gpu_utilization',
    label: 'GPU utilization',
    group: 'utilization',
    unit: '%',
    objective: 'maximize',
  },
  {
    key: 'tpot_mean_ms',
    label: 'Mean TPOT',
    group: 'tpot',
    unit: 'ms/token',
    objective: 'minimize',
  },
  {
    key: 'ttft_mean_ms',
    label: 'Mean TTFT',
    group: 'ttft',
    unit: 'ms',
    objective: 'minimize',
  },
];

describe('sweep metric sections', () => {
  it('groups outcome families and folds mean/p99 into one panel', () => {
    const sections = sweepMetricSections(metrics);

    expect(
      sections
        .flatMap((section) => section.panels)
        .filter((panel) => ['tpot', 'ttft'].includes(panel.id)),
    ).toMatchObject([
      {
        id: 'tpot',
        metrics: [{ key: 'tpot_mean_ms' }, { key: 'tpot_p99_ms' }],
      },
      {
        id: 'ttft',
        metrics: [{ key: 'ttft_mean_ms' }],
      },
    ]);
  });
});
