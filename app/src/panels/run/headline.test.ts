import { describe, expect, it } from 'vitest';

import type { RunLatency, RunSummary } from '../../artifacts';
import { headlineStats, runProvenance } from './headline';

const SUMMARY: RunSummary = {
  cause: 'DrainComplete',
  totalTokensPerSecond: 1279.42,
  totalTokensPerSecondPerGpu: 1279.42,
  prefillTokensPerSecond: 1023.53,
  decodeTokensPerSecond: 255.88,
  completedRequestsPerSecond: 0.99,
  gpus: 8,
  requestsFinished: 512,
  requestsTotal: 512,
  prefillTokens: 524288,
  decodeTokens: 131072,
  totalTokens: 655360,
  simulatedMs: 512231.1,
  wallSeconds: 0.2066,
  realtimeFactor: 2479.34,
};

function latency(series: RunLatency['series']): RunLatency {
  return { series, definitions: {} };
}

const MARKERS = { p50: 25.7, p90: 27.5, p99: 27.9 };
const CDF = { x: [] as number[], yPct: [] as number[] };

describe('headlineStats', () => {
  it('leads with the number the run exists to report', () => {
    const [first] = headlineStats(SUMMARY, undefined);
    expect(first).toMatchObject({
      label: 'Throughput',
      value: '1,279.42',
      unit: 'tok/s',
      lead: true,
    });
  });

  it('shows dashes rather than nothing when the latencies are missing', () => {
    // A run whose analysis has not produced latencies still has a throughput.
    // Dropping the slots would move the other figures under the wrong labels.
    const labels = headlineStats(SUMMARY, undefined).map((stat) => stat.label);
    expect(labels).toEqual(['Throughput', 'GPUs', 'Requests', 'TTFT p50', 'TPOT p50', 'E2E p50']);
    expect(headlineStats(SUMMARY, undefined).at(-1)?.value).toBe('—');
  });

  it('puts the latencies in reading order, not the order they were served', () => {
    const stats = headlineStats(
      SUMMARY,
      latency([
        { key: 'e2e', label: 'E2E', unit: 'ms', count: 512, markers: MARKERS, ...CDF },
        { key: 'ttft', label: 'TTFT', unit: 'ms', count: 512, markers: MARKERS, ...CDF },
        { key: 'tpot', label: 'TPOT', unit: 'ms', count: 512, markers: MARKERS, ...CDF },
      ]),
    );
    expect(stats.slice(3).map((stat) => stat.label)).toEqual(['TTFT p50', 'TPOT p50', 'E2E p50']);
  });

  it('keeps a series this build has never heard of, at the end', () => {
    // The analyzer's vocabulary grows, and a p50 nobody has heard of is still
    // a p50.
    const stats = headlineStats(
      SUMMARY,
      latency([
        { key: 'queue', label: 'Queue', unit: 'ms', count: 512, markers: MARKERS, ...CDF },
        { key: 'ttft', label: 'TTFT', unit: 'ms', count: 512, markers: MARKERS, ...CDF },
      ]),
    );
    expect(stats.slice(3).map((stat) => stat.label)).toEqual(['TTFT p50', 'Queue p50']);
  });

  it('changes the unit when milliseconds stop reading as milliseconds', () => {
    // 41,000 ms is a number a reader has to count digits in.
    const stats = headlineStats(
      SUMMARY,
      latency([
        {
          key: 'e2e',
          label: 'E2E',
          unit: 'ms',
          count: 1,
          markers: { p50: 41000, p90: 1, p99: 1 },
          ...CDF,
        },
      ]),
    );
    expect(stats.at(-1)).toMatchObject({ value: '41.00', unit: 's' });
  });

  it('keeps an empty producer metric in place as a dash', () => {
    const stats = headlineStats(
      SUMMARY,
      latency([{ key: 'tpot', label: 'TPOT', unit: 'ms/token', count: 0, markers: null, ...CDF }]),
    );
    expect(stats.at(-1)).toMatchObject({ label: 'TPOT p50', value: '—', unit: '' });
  });
});

describe('runProvenance', () => {
  it('says the run finished everything it was given', () => {
    expect(runProvenance(SUMMARY)).toContain('all 512 requests');
    expect(runProvenance(SUMMARY)).toContain('draining to completion');
  });

  it('says so when the run stopped early', () => {
    // The cause can invalidate every figure above it: a run that stopped early
    // has a throughput that is not the workload's throughput.
    const stopped = { ...SUMMARY, requestsFinished: 400, cause: 'MaxTime' };
    expect(runProvenance(stopped)).toContain('400 of 512 requests');
    expect(runProvenance(stopped)).toContain('stopping at the time limit');
  });

  it('shows a stop reason it does not recognize rather than calling it finished', () => {
    expect(runProvenance({ ...SUMMARY, cause: 'HostOom' })).toContain('stopping on HostOom');
  });
});
