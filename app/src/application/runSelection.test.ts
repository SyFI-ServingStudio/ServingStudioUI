import { describe, expect, it } from 'vitest';

import { makeWorkerKey } from '../domain/worker';
import { makeTestDescriptor, makeTestTopology } from '../test/analyzerRepositoryFixture';
import { assembleActiveRunCore } from './loadActiveRun';
import { currentWorker, scopedKv, scopedUtil } from './runSelection';

const run = assembleActiveRunCore(
  makeTestDescriptor(),
  { totalTokS: 10, numGpus: 2, requestsFinished: 1 },
  makeTestTopology(),
).run;

describe('run selection identity', () => {
  it('requires the exact composite worker key and never falls back to the first worker', () => {
    expect(currentWorker(run, { workerKey: makeWorkerKey('ffn', '0') }).pool).toBe('ffn');
    expect(() => currentWorker(run, { workerKey: makeWorkerKey('stale', '0') })).toThrow(
      'Selected worker stale/0 is not present in run test-run.',
    );
    expect(() => currentWorker(run, { workerKey: null })).toThrow(
      'Run test-run has no selected worker.',
    );
  });

  it('filters pool metrics only by the wire poolTag identity', () => {
    const utilization = scopedUtil(
      {
        t_ms: [0],
        series: [
          { key: 'opaque', label: 'attn-looking label', util: [0.2] },
          { key: 'also-opaque', label: 'not attn', poolTag: 'attn', util: [0.4] },
          { key: 'attn/forged', label: 'attn', poolTag: 'ffn', util: [0.6] },
        ],
      },
      'attn',
    );
    const kv = scopedKv(
      {
        t_ms: [0],
        series: [
          { key: 'opaque', label: 'attn-looking label', capacity: 1, active: [1] },
          { key: 'also-opaque', label: 'not attn', poolTag: 'attn', capacity: 1, active: [1] },
        ],
      },
      'attn',
    );

    expect(utilization.series.map((series) => series.key)).toEqual(['also-opaque']);
    expect(kv.series.map((series) => series.key)).toEqual(['also-opaque']);
  });
});
