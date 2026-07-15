import { describe, expect, it } from 'vitest';

import { makeWorkerKey } from '../domain/worker';
import {
  createTestRepository,
  makeTestDescriptor,
  makeTestSubjectResults,
  makeTestTopology,
  TEST_WORKERS,
} from '../test/analyzerRepositoryFixture';
import { loadActiveRunData } from './loadActiveRun';

describe('loadActiveRunData', () => {
  it('assembles one run while preserving same-numbered workers in different pools', async () => {
    const descriptor = makeTestDescriptor();
    const { repository } = createTestRepository({ descriptor });

    const active = await loadActiveRunData(repository, descriptor);

    expect(active.run.workerList.map((worker) => worker.key)).toEqual([
      makeWorkerKey(TEST_WORKERS[0]),
      makeWorkerKey(TEST_WORKERS[1]),
    ]);
    expect(active.run.workerList.map((worker) => worker.id)).toEqual(['0', '0']);
    expect(active.subjects.backpressure).toMatchObject({ status: 'not_generated' });
    expect(active.run.payloads.pendingQueue).toBeUndefined();
    expect(active.run.source.simulationReexecuted).toBeNull();
  });

  it('rejects duplicate composite worker identities in the descriptor', async () => {
    const descriptor = makeTestDescriptor({ workers: [TEST_WORKERS[0], TEST_WORKERS[0]] });
    const { repository } = createTestRepository({ descriptor });

    await expect(loadActiveRunData(repository, descriptor)).rejects.toThrow(
      'Run descriptor contains duplicate composite worker identities.',
    );
  });

  it('rejects an empty topology before attempting to load worker trees', async () => {
    const descriptor = makeTestDescriptor({ workers: undefined });
    const { repository, calls } = createTestRepository({ descriptor, topology: { pools: [] } });

    await expect(loadActiveRunData(repository, descriptor)).rejects.toThrow(
      'Run topology has no workers.',
    );
    expect(calls.trees).toBe(0);
  });

  it('rejects topology model drift instead of silently using the first model', async () => {
    const topology = makeTestTopology();
    topology.pools[1].groups[0].arch.model = 'model/other.json';
    const descriptor = makeTestDescriptor();
    const { repository } = createTestRepository({ descriptor, topology });

    await expect(loadActiveRunData(repository, descriptor)).rejects.toThrow(
      'has 2 topology model identities; the current view requires one.',
    );
  });

  it('fails explicitly when a required subject is unavailable', async () => {
    const subjects = makeTestSubjectResults();
    subjects.slo = {
      subject: 'slo',
      status: 'unavailable',
      code: 'missing_request_events',
      reason: 'Request lifecycle events were not logged.',
    };
    const descriptor = makeTestDescriptor();
    const { repository } = createTestRepository({ descriptor, subjects });

    await expect(loadActiveRunData(repository, descriptor)).rejects.toThrow(
      'Required analyzer subject slo is unavailable: Request lifecycle events were not logged.',
    );
  });
});
