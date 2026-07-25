import type { EChartsOption } from 'echarts';
import { throughputOption, utilizationOption, kvOption, pendingQueueOption } from './options';
import { CHART_THEME } from '../charts/platform';
import {
  cursorSeconds,
  scopedUtil,
  scopedKv,
  scopedWorkerUtil,
  scopedWorkerKv,
  scopedPendingQueue,
  poolInScope,
  type RunSelection,
} from '../application/runSelection';
import type { Run } from '../domain/run';
import type { SubjectResult } from '../domain/subject';
import { subjectStatusLabel, subjectStatusMessage } from '../application/subjectStatus';

export type MetricKey = 'throughput' | 'utilization' | 'kv' | 'backpressure';

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
  s: RunSelection,
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
  if (subject.subject === 'throughput')
    return {
      option: throughputOption(subject.payload, CHART_THEME, cS),
      note: null,
      sub: 'total ∥ prefill ∥ decode · tok/s',
    };
  if (subject.subject === 'utilization') {
    const workerScoped =
      (s.scope === 'worker' || s.scope === 'kernel' || s.scope === 'parallel') &&
      s.workerKey !== null;
    const utilization = workerScoped
      ? scopedWorkerUtil(subject.payload, s.workerKey)
      : scopedUtil(subject.payload, role);
    if (utilization.series.length === 0 && utilization.workerSeries.length === 0) {
      return {
        option: null,
        note: null,
        sub: 'ready · empty',
        empty: `The utilization subject has no GPU series for the ${role ?? 'selected'} scope.`,
      };
    }
    return {
      option: utilizationOption(utilization, CHART_THEME, cS),
      note: workerScoped
        ? 'selected worker only'
        : role
          ? `scoped to ${role} pool; bold line is the pool average`
          : 'worker lines with bold pool averages; click a pool to scope',
      sub: workerScoped
        ? `worker: ${s.workerKey}`
        : role
          ? `${utilization.workerSeries.length} workers · pool: ${role}`
          : `${utilization.workerSeries.length} workers · ${utilization.series.length} pools`,
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
  const workerScoped =
    (s.scope === 'worker' || s.scope === 'kernel' || s.scope === 'parallel') &&
    s.workerKey !== null;
  const kv = workerScoped
    ? scopedWorkerKv(subject.payload, s.workerKey)
    : scopedKv(subject.payload, role);
  if (!kv.series.length && !kv.workerSeries.length)
    return {
      option: null,
      note: null,
      sub: role ? `pool: ${role}` : '—',
      empty: `The KV subject has no cache series for the ${role ?? 'selected'} scope.`,
    };
  const hasCompleteCapacity = kv.series.every((series) => series.capacity !== null);
  return {
    option: kvOption(kv, CHART_THEME, cS),
    note: workerScoped
      ? 'selected worker only'
      : role
        ? `scoped to ${role} pool; bold line is the pool average`
        : hasCompleteCapacity
          ? 'worker lines with bold pool averages; click a pool to scope'
          : 'raw worker occupancy with bold pool averages; capacity metadata unavailable',
    sub: workerScoped
      ? `worker: ${s.workerKey}`
      : role
        ? `${kv.workerSeries.length} workers · pool: ${role}`
        : `${kv.workerSeries.length} workers · ${kv.series.length} pools`,
  };
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  throughput: 'Throughput',
  utilization: 'GPU utilization',
  kv: 'KV occupancy',
  backpressure: 'Backpressure',
};
export const METRIC_CAPTIONS: Record<MetricKey, string> = {
  throughput:
    'Total, prefill, and decode tokens per second over each analyzer interval; the total is emphasized.',
  utilization: 'Per-worker GPU busy fraction over time, with bold pool-average lines.',
  kv: 'Per-worker active KV-cache occupancy over time, with bold pool-average lines.',
  backpressure:
    'Pending scheduler-queue length over wall-clock time. Cluster and pool totals are stacked from their worker queues; the outline is the exact pointwise sum.',
};
