import { describe, expect, it } from 'vitest';

import { makeWorkerKey } from '../domain/worker';
import {
  createTestRepository,
  makeTestDescriptor,
  makeTestSubjectResults,
  makeTestTopology,
  TEST_WORKERS,
} from '../test/analyzerRepositoryFixture';
import { assembleActiveRunData, loadActiveRunCore } from './loadActiveRun';

describe('active-run core assembly', () => {
  it('assembles one run while preserving same-numbered workers in different pools', async () => {
    const descriptor = makeTestDescriptor();
    const { repository, calls } = createTestRepository({ descriptor });

    const core = await loadActiveRunCore(repository, descriptor);
    const active = assembleActiveRunData(core, makeTestSubjectResults());

    expect(active.run.workerList.map((worker) => worker.key)).toEqual([
      makeWorkerKey(TEST_WORKERS[0]),
      makeWorkerKey(TEST_WORKERS[1]),
    ]);
    expect(active.run.workerList.map((worker) => worker.id)).toEqual(['0', '0']);
    expect(active.subjects.backpressure).toMatchObject({ status: 'not_generated' });
    expect(active.run.payloads.pendingQueue).toBeUndefined();
    expect(active.run.source.simulationFolder).toBe('test-run');
    expect(active.run.source.simulationReexecuted).toBeNull();
    expect(calls.subjects).toBe(0);
    expect(calls.trees).toBe(0);
  });

  it('uses the server display label rather than interpreting an opaque HTTP id as a path', async () => {
    const descriptor = makeTestDescriptor({
      runId: 'r_opaque_01',
      displayName: 'sweeps/tp4/simulation',
      provenance: {
        source: 'analyzer',
        synthetic: false,
        generatedAt: '2026-07-15T00:00:00Z',
      },
    });
    const { repository } = createTestRepository({ descriptor });

    const core = await loadActiveRunCore(repository, descriptor);

    expect(core.run.source.simulationFolder).toBe('sweeps/tp4/simulation');
  });

  it('rejects duplicate composite worker identities in the descriptor', async () => {
    const descriptor = makeTestDescriptor({ workers: [TEST_WORKERS[0], TEST_WORKERS[0]] });
    const { repository } = createTestRepository({ descriptor });

    await expect(loadActiveRunCore(repository, descriptor)).rejects.toThrow(
      'Run descriptor contains duplicate composite worker identities.',
    );
  });

  it('rejects an empty topology without attempting to load worker trees', async () => {
    const descriptor = makeTestDescriptor({ workers: undefined });
    const { repository, calls } = createTestRepository({ descriptor, topology: { pools: [] } });

    await expect(loadActiveRunCore(repository, descriptor)).rejects.toThrow(
      'Run topology has no workers.',
    );
    expect(calls.trees).toBe(0);
  });

  it('rejects topology model drift instead of silently using the first model', async () => {
    const topology = makeTestTopology();
    topology.pools[1].groups[0].arch.model = 'model/other.json';
    const descriptor = makeTestDescriptor();
    const { repository } = createTestRepository({ descriptor, topology });

    await expect(loadActiveRunCore(repository, descriptor)).rejects.toThrow(
      'has 2 topology model identities; the current view requires one.',
    );
  });

  it('preserves an unavailable SLO subject without rejecting the core run', async () => {
    const subjects = makeTestSubjectResults();
    subjects.slo = {
      subject: 'slo',
      status: 'unavailable',
      code: 'missing_request_events',
      reason: 'Request lifecycle events were not logged.',
    };
    const descriptor = makeTestDescriptor();
    const { repository, calls } = createTestRepository({ descriptor, subjects });

    const core = await loadActiveRunCore(repository, descriptor);
    const active = assembleActiveRunData(core, subjects);

    expect(active.run.id).toBe('test-run');
    expect(active.subjects.slo).toEqual(subjects.slo);
    expect(active.run.payloads.slo).toBeUndefined();
    expect(active.run.summary.ttft_p50).toBeUndefined();
    expect(calls.subjects).toBe(0);
  });
});
