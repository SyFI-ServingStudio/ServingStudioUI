import type { EChartsOption } from 'echarts';
import {
  sloOption,
  throughputOption,
  utilizationOption,
  kvOption,
  pendingQueueOption,
  CHART_THEME,
} from './options';
import type { VizState, MetricKey } from '../store';
import {
  cursorSeconds,
  scopedUtil,
  scopedKv,
  scopedPendingQueue,
  poolInScope,
} from '../application/runSelection';
import type { Run } from '../domain/run';

export interface MetricView {
  option: EChartsOption | null;
  note: string | null;
  sub: string;
}

/** Build the scoped ECharts option + sub-label + optional note for a metric.
 *  Time-axis charts get a cursor at the selected iteration (if any). */
export function metricView(key: MetricKey, run: Run, s: VizState): MetricView {
  const role = poolInScope(run, s);
  const cS = cursorSeconds(s);
  if (key === 'slo')
    return {
      option: sloOption(run.payloads.slo, CHART_THEME),
      note: null,
      sub: 'TTFT · TPOT · E2E · CDF',
    };
  if (key === 'throughput')
    return {
      option: throughputOption(run.payloads.throughput, CHART_THEME, cS),
      note: null,
      sub: 'prefill ∥ decode · tok/s',
    };
  if (key === 'utilization') {
    return {
      option: utilizationOption(scopedUtil(run, s), CHART_THEME, cS),
      note: role ? `scoped to ${role} pool` : 'click a pool to scope',
      sub: role ? `pool: ${role}` : 'all pools',
    };
  }
  if (key === 'backpressure') {
    const queue = scopedPendingQueue(run, s);
    if (!queue.total.length)
      return { option: null, note: 'no pending-queue payload for this scope', sub: 'unavailable' };
    const peak = Math.max(...queue.total);
    const mean = queue.total.reduce((sum, value) => sum + value, 0) / queue.total.length;
    const note = queue.stacked
      ? `${queue.totalLabel}; stacked areas show each worker's contribution`
      : `${queue.totalLabel}; requests waiting for scheduler admission`;
    return {
      option: pendingQueueOption(queue, CHART_THEME, cS),
      note,
      sub: `peak ${peak} · mean ${mean.toFixed(1)}`,
    };
  }
  const kv = scopedKv(run, s);
  if (!kv.series.length)
    return {
      option: null,
      note: `no KV cache on ${role ?? '—'} pool`,
      sub: role ? `pool: ${role}` : '—',
    };
  return {
    option: kvOption(kv, CHART_THEME, cS),
    note: role ? `scoped to ${role} pool` : 'aggregate across pools',
    sub: role ? `pool: ${role}` : '% of capacity',
  };
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  slo: 'SLO latency',
  throughput: 'Throughput',
  utilization: 'GPU utilization',
  kv: 'KV occupancy',
  backpressure: 'Backpressure',
};
export const METRIC_CAPTIONS: Record<MetricKey, string> = {
  slo: 'Cumulative distribution of TTFT, TPOT and end-to-end latency across all requests. Dotted markers show p90.',
  throughput: 'Prefill and decode tokens per second, stacked — warmup ramp then steady state.',
  utilization: 'Per-pool GPU busy fraction over the run window.',
  kv: 'Active KV-cache tokens as a percentage of pool capacity over time.',
  backpressure:
    'Pending scheduler-queue length over wall-clock time. Cluster and pool totals are stacked from their worker queues; the outline is the exact pointwise sum.',
};
