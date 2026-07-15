import { describe, expect, it, vi } from 'vitest';

import { REAL_RUNS } from '../data/realRunFixture';
import { FixtureAnalyzerRepository } from './FixtureAnalyzerRepository';

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
});
