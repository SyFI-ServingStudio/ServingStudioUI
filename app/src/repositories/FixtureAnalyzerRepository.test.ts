import { describe, expect, it, vi } from 'vitest';

import { REAL_RUNS } from '../data/realRunFixture';
import { annotate, leaf } from '../data/tree';
import type { Run } from '../domain/run';
import {
  FixtureAnalyzerRepository,
  FixtureDetailUnavailableError,
} from './FixtureAnalyzerRepository';

describe('FixtureAnalyzerRepository fixture loading', () => {
  it('starts lazily and shares one fixture module load across concurrent reads', async () => {
    const loader = vi.fn(async (): Promise<readonly (typeof REAL_RUNS)[number][]> => REAL_RUNS);
    const repository = new FixtureAnalyzerRepository(undefined, loader);
    const runId = REAL_RUNS[0].id;

    expect(loader).not.toHaveBeenCalled();
    const [catalog, descriptor] = await Promise.all([
      repository.listRuns(),
      repository.getRunDescriptor(runId),
    ]);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(catalog.map((run) => run.runId)).toContain(runId);
    expect(descriptor.runId).toBe(runId);
  });

  it('evicts a rejected module load so a later query can retry', async () => {
    let attempt = 0;
    const loader = vi.fn(async (): Promise<readonly (typeof REAL_RUNS)[number][]> => {
      attempt += 1;
      if (attempt === 1) throw new Error('fixture chunk unavailable');
      return REAL_RUNS;
    });
    const repository = new FixtureAnalyzerRepository(undefined, loader);

    await expect(repository.listRuns()).rejects.toThrow(
      'Could not load bundled analyzer fixtures: fixture chunk unavailable',
    );
    await expect(repository.listRuns()).resolves.toHaveLength(REAL_RUNS.length);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps synthetic hierarchical trees in an explicit detail index', async () => {
    const source = REAL_RUNS[0];
    const worker = source.workerList[0];
    if (worker === undefined) throw new Error('The checked-in fixture must contain a worker.');
    const syntheticRun: Run = {
      ...source,
      id: 'synthetic-tree-run',
      name: 'Synthetic tree run',
      source: {
        kind: 'synthetic',
        simulationFolder: 'synthetic-tree-run',
        simulationReexecuted: null,
      },
    };
    const detailTree = annotate(leaf('detail.kernel', 'single_gemm', '{}', 2));
    const repository = new FixtureAnalyzerRepository(
      [syntheticRun],
      async () => [syntheticRun],
      new Map([[syntheticRun.id, new Map([[worker.key, detailTree]])]]),
    );

    await expect(repository.getRunDescriptor(syntheticRun.id)).resolves.toMatchObject({
      details: { 'worker-cost-tree': { status: 'ready', schemaVersion: 1 } },
    });
    await expect(repository.getWorkerCostTree(syntheticRun.id, worker.ref)).resolves.toBe(
      detailTree,
    );
  });

  it('does not reinterpret aggregate kernel composition as worker detail', async () => {
    const run = REAL_RUNS[0];
    const worker = run.workerList[0];
    if (worker === undefined) throw new Error('The checked-in fixture must contain a worker.');
    const repository = new FixtureAnalyzerRepository([run]);

    await expect(repository.getWorkerCostTree(run.id, worker.ref)).rejects.toBeInstanceOf(
      FixtureDetailUnavailableError,
    );
  });
});
