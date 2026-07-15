import type { EChartsOption } from 'echarts';
import {
  sloOption,
  throughputOption,
  utilizationOption,
  kvOption,
  pendingQueueOption,
} from './options';
import { CHART_THEME } from './platform';
import type { VizState, MetricKey } from '../store';
import {
  cursorSeconds,
  scopedUtil,
  scopedKv,
  scopedPendingQueue,
  poolInScope,
} from '../application/runSelection';
import type { Run } from '../domain/run';
import type { SubjectResult } from '../domain/subject';
import { subjectStatusLabel, subjectStatusMessage } from '../application/subjectStatus';

export interface MetricView {
  option: EChartsOption | null;
  note: string | null;
  sub: string;
  empty?: string;
}

type MetricSubjectResult = { [Name in MetricKey]: SubjectResult<Name> }[MetricKey];

interface MetricProjection {
  poolRole?: string;
}

/** Build the scoped ECharts option + sub-label + optional note for a metric.
 *  Time-axis charts get a cursor at the selected iteration (if any). */
export function metricView(
  subject: MetricSubjectResult,
  run: Run,
  s: VizState,
  projection: MetricProjection = {},
): MetricView {
  if (subject.status !== 'ready') {
    return {
      option: null,
      note: null,
      sub: subjectStatusLabel(subject),
      empty: subjectStatusMessage(subject),
    };
  }

  const role = projection.poolRole ?? poolInScope(run, s);
  const cS = cursorSeconds(s);
  if (subject.subject === 'slo')
    return {
      option: sloOption(subject.payload, CHART_THEME),
      note: null,
      sub: 'TTFT · TPOT · E2E · CDF',
    };
  if (subject.subject === 'throughput')
    return {
      option: throughputOption(subject.payload, CHART_THEME, cS),
      note: null,
      sub: 'prefill ∥ decode · tok/s',
    };
  if (subject.subject === 'utilization') {
    const utilization = scopedUtil(subject.payload, role);
    if (utilization.series.length === 0) {
      return {
        option: null,
        note: null,
        sub: 'ready · empty',
        empty: `The utilization subject has no GPU series for the ${role ?? 'selected'} scope.`,
      };
    }
    return {
      option: utilizationOption(utilization, CHART_THEME, cS),
      note: role ? `scoped to ${role} pool` : 'click a pool to scope',
      sub: role ? `pool: ${role}` : 'all pools',
    };
  }
  if (subject.subject === 'backpressure') {
    const queue = scopedPendingQueue(subject.payload, run, s);
    if (!queue.total.length)
      return {
        option: null,
        note: null,
        sub: 'ready · empty',
        empty: 'The pending-queue subject has no samples for this scope.',
      };
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
  const kv = scopedKv(subject.payload, role);
  if (!kv.series.length)
    return {
      option: null,
      note: null,
      sub: role ? `pool: ${role}` : '—',
      empty: `The KV subject has no cache series for the ${role ?? 'selected'} scope.`,
    };
  const hasCompleteCapacity = kv.series.every((series) => series.capacity !== null);
  return {
    option: kvOption(kv, CHART_THEME, cS),
    note: role
      ? `scoped to ${role} pool`
      : hasCompleteCapacity
        ? 'aggregate across pools'
        : 'raw occupancy; capacity metadata unavailable',
    sub: role ? `pool: ${role}` : hasCompleteCapacity ? '% of capacity' : 'active KV tokens',
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
  kv: 'Active KV-cache tokens over time; shown as capacity percentage when metadata is available.',
  backpressure:
    'Pending scheduler-queue length over wall-clock time. Cluster and pool totals are stacked from their worker queues; the outline is the exact pointwise sum.',
};
