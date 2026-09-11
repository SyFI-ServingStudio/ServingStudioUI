import { describe, expect, it } from 'vitest';

import utilizationJson from '../../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/utilization_series.json';
import type { UtilizationTimeline } from '../../artifacts';
import { CHART_THEME } from '../../ui/charts/platform';
import { utilizationOption } from './option';

describe('utilizationOption', () => {
  it('keeps the accepted option from the same Analyzer payload', () => {
    const timeline = withWorkerLines(timelineFromFixture());
    expect(utilizationOption(timeline, CHART_THEME, 12.5)).toMatchSnapshot();
  });

  it('keeps every pool average and additive worker shadow line', () => {
    const timeline = withWorkerLines(timelineFromFixture());
    const option = utilizationOption(timeline, CHART_THEME);

    expect(option.series).toHaveLength(timeline.series.length + timeline.workerSeries.length);
    expect(option.yAxis).toMatchObject({ max: 105 });
  });
});

function withWorkerLines(timeline: UtilizationTimeline): UtilizationTimeline {
  return {
    ...timeline,
    workerSeries: timeline.series.map((series, index) => ({
      key: `worker_${index}_0`,
      label: `${series.poolTag}/0`,
      worker: { poolTag: series.poolTag, workerId: '0' },
      util: [...series.util],
    })),
  };
}

function timelineFromFixture(): UtilizationTimeline {
  return {
    tMs: utilizationJson.t_start_ms.map(
      (start, index) => (start + utilizationJson.t_end_ms[index]) / 2,
    ),
    series: utilizationJson.series.map((series) => ({
      key: series.key,
      label: series.label,
      poolTag: series.pool_tag,
      util: series.util,
    })),
    workerSeries: [],
    sourceLogDir: utilizationJson.meta.log_dir,
    gpuName: utilizationJson.meta.gpu_name,
    unit: utilizationJson.meta.unit,
    workerUnit: null,
    averages: utilizationJson.meta.avg,
    definitions: utilizationJson.definitions,
  };
}
