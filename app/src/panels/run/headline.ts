/**
 * The numbers a reader sees first, chosen and formatted.
 *
 * Pure, and separate from the panel, because "which six numbers" is a judgement
 * that should be arguable in a test rather than buried in JSX. The judgement is
 * this: throughput is what the run was for, GPUs and requests say what produced
 * it, and the three latency percentiles are what decides whether the throughput
 * was worth having.
 *
 * Latency is optional on purpose. A run whose analysis has not produced
 * latencies is still a run with a throughput, and an overview that refused to
 * render without them would hide the half it has.
 */
import type { RunLatency, RunSummary } from '../../artifacts';

export interface Stat {
  readonly label: string;
  /** Already formatted. The panel prints it; it does not decide precision. */
  readonly value: string;
  readonly unit: string;
  /** True for the one number the run exists to report. */
  readonly lead: boolean;
}

/** The order the analyzer serves them in is not a reading order. */
const LATENCY_ORDER = ['ttft', 'tpot', 'e2e'];

export function headlineStats(summary: RunSummary, latency: RunLatency | undefined): Stat[] {
  return [
    {
      label: 'Throughput',
      value: summary.totalTokensPerSecond.toLocaleString('en-US'),
      unit: 'tok/s',
      lead: true,
    },
    { label: 'GPUs', value: integer(summary.gpus), unit: '', lead: false },
    { label: 'Requests', value: integer(summary.requestsFinished), unit: '', lead: false },
    ...latencyStats(latency),
  ];
}

/**
 * One stat per latency series, in reading order.
 *
 * A series this build does not know about is appended rather than dropped: the
 * analyzer's vocabulary grows, and a p50 nobody has heard of is still a p50.
 */
function latencyStats(latency: RunLatency | undefined): Stat[] {
  if (latency === undefined) {
    return LATENCY_ORDER.map((key) => ({
      label: `${defaultLabel(key)} p50`,
      value: '—',
      unit: '',
      lead: false,
    }));
  }
  const ordered = [...latency.series].sort((left, right) => rank(left.key) - rank(right.key));
  return ordered.map((series) => {
    const p50 = series.markers?.p50;
    const presentation =
      series.key === 'e2e'
        ? { value: p50 === undefined ? '—' : (p50 / 1000).toFixed(2), unit: 's' }
        : series.key === 'ttft'
          ? { value: p50 === undefined ? '—' : p50.toFixed(0), unit: 'ms' }
          : { value: p50 === undefined ? '—' : p50.toFixed(1), unit: 'ms' };
    return {
      label: `${LATENCY_ORDER.includes(series.key) ? defaultLabel(series.key) : series.label} p50`,
      value: presentation.value,
      unit: p50 === undefined ? '' : presentation.unit,
      lead: false,
    };
  });
}

function rank(key: string): number {
  const at = LATENCY_ORDER.indexOf(key);
  return at === -1 ? LATENCY_ORDER.length : at;
}

function defaultLabel(key: string): string {
  return key.toUpperCase();
}

/**
 * Milliseconds, until they stop reading as milliseconds.
 *
 * An end-to-end latency of 41,000 ms is a number a reader has to count digits
 * in. The same value as 41.0 s is read at a glance, and the unit moves with it
 * so nothing is claimed that is not shown.
 */
function trimmed(value: number): string {
  return String(Number(value.toFixed(2)));
}

function integer(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/**
 * What the run did, in one sentence, under the numbers.
 *
 * The cause is included because it is the one field that can invalidate
 * everything above it: a run that stopped early has a throughput that is not
 * the throughput of the workload it was given.
 */
export function runProvenance(summary: RunSummary): string {
  const simulated = seconds(summary.simulatedMs / 1000);
  const finished =
    summary.requestsFinished === summary.requestsTotal
      ? `all ${integer(summary.requestsTotal)} requests`
      : `${integer(summary.requestsFinished)} of ${integer(summary.requestsTotal)} requests`;
  return `${finished} over ${simulated} of simulated time, ${describeCause(summary.cause)}. Simulated ${trimmed(summary.realtimeFactor)}× faster than real time, in ${seconds(summary.wallSeconds)} of wall clock.`;
}

/**
 * The simulator's stop reasons, in words.
 *
 * Anything unrecognized is shown as served rather than mapped to "finished":
 * the whole reason to print the cause is that it can say the run did not.
 */
function describeCause(cause: string): string {
  if (cause === 'DrainComplete') return 'draining to completion';
  if (cause === 'MaxRequests') return 'stopping at the request limit';
  if (cause === 'MaxTime') return 'stopping at the time limit';
  return `stopping on ${cause}`;
}

function seconds(value: number): string {
  if (value >= 60) {
    const minutes = Math.floor(value / 60);
    return `${minutes}m ${Math.round(value - minutes * 60)}s`;
  }
  return `${Number(value.toFixed(value < 10 ? 2 : 0))}s`;
}
