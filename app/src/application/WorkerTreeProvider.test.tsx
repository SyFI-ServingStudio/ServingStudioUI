import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Run } from '../domain/run';
import { makeWorkerKey, makeWorkerRef } from '../domain/worker';
import { createTestRepository } from '../test/analyzerRepositoryFixture';
import { useViz } from '../store';
import { analyzerQueryKeys } from './queries';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';
import { ActiveWorkerTreeProvider, useActiveWorkerOperationState } from './WorkerTreeProvider';

function OperationProbe() {
  const state = useActiveWorkerOperationState();
  return <div data-testid="operation-probe" data-status={state.status} />;
}

const worker = makeWorkerRef('ffn', 0);
const run: Run = {
  id: 'test-run',
  name: 'Test run',
  model: 'model/test.json',
  deployment: 'afd',
  gpu: 'H200',
  summary: { total_tok_s: 1, num_gpus: 1, requests: 1 },
  topology: { pools: [] },
  workerList: [
    {
      key: makeWorkerKey(worker),
      ref: worker,
      id: '0',
      pool: 'ffn',
      workerType: 'test',
      archType: 'test',
      gpu: 'H200',
      gpuCount: 1,
      gpus: [0],
      dp: null,
      arch: { type: 'test', model: 'model/test.json', params: {} },
      worker: { type: 'test' },
    },
  ],
  gpuTotal: 1,
  source: { kind: 'analyzer_http', simulationFolder: 'test', simulationReexecuted: null },
  capabilities: { perfettoTrace: false },
};

afterEach(() => vi.useRealTimers());

describe('operation detail cache identity', () => {
  it('keys CostTree by the exact OperationRef tuple', () => {
    const key = analyzerQueryKeys.workerCostTreeDetail(
      'run-a',
      { worker, iterId: '17', batchId: '9', operationId: '3' },
      1,
      'revision-a',
    );
    expect(key).toContain('operation-ref');
    expect(key).toContain('17');
    expect(key).toContain('9');
    expect(key).toContain('3');
  });
});

describe('ActiveWorkerTreeProvider operation buffer', () => {
  it('bootstraps a bounded operation buffer', async () => {
    const { repository } = createTestRepository();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useViz.setState({
      scope: 'worker',
      workerKey: makeWorkerKey(worker),
      poolRole: 'ffn',
      cursorMs: null,
      cursorNeedsSeek: false,
      operation: null,
      workerAnalysisLevel: 'worker',
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AnalyzerRepositoryProvider repository={repository}>
          <ActiveWorkerTreeProvider
            run={run}
            workerOperationDetail={{
              status: 'ready',
              schemaVersion: 1,
              resource: { href: 'workers' },
            }}
            workerCostTreeDetail={{ status: 'not_generated' }}
            analysisRevision="revision-a"
          >
            <OperationProbe />
          </ActiveWorkerTreeProvider>
        </AnalyzerRepositoryProvider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('operation-probe')).toHaveAttribute('data-status', 'ready'),
    );
  });

  it('preserves the selected operation while a fused wall-clock seek is pending', async () => {
    vi.useFakeTimers();
    const { repository } = createTestRepository();
    const originalSeek = repository.getWorkerOperationSeek.bind(repository);
    let resolveSeek: ((value: Awaited<ReturnType<typeof originalSeek>>) => void) | undefined;
    vi.spyOn(repository, 'getWorkerOperationSeek').mockImplementation(
      () => new Promise((resolve) => (resolveSeek = resolve)),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useViz.setState({
      scope: 'worker',
      workerKey: makeWorkerKey(worker),
      poolRole: 'ffn',
      cursorMs: 10,
      cursorNeedsSeek: false,
      operation: { iterId: 'old', batchId: '0', operationId: 'old' },
      workerAnalysisLevel: 'iteration',
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AnalyzerRepositoryProvider repository={repository}>
          <ActiveWorkerTreeProvider
            run={run}
            workerOperationDetail={{
              status: 'ready',
              schemaVersion: 1,
              resource: { href: 'workers' },
            }}
            workerCostTreeDetail={{ status: 'not_generated' }}
            analysisRevision="revision-a"
          >
            <OperationProbe />
          </ActiveWorkerTreeProvider>
        </AnalyzerRepositoryProvider>
      </QueryClientProvider>,
    );
    act(() => useViz.getState().setTime(11));
    expect(useViz.getState().operation).toEqual({
      iterId: 'old',
      batchId: '0',
      operationId: 'old',
    });
    await act(() => vi.advanceTimersByTimeAsync(150));
    const result = await originalSeek(run.id, worker, 11, 64);
    await act(async () => resolveSeek?.(result));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(useViz.getState().operation).toEqual({ iterId: '7', batchId: '3', operationId: '0' });
    expect(useViz.getState().cursorMs).toBe(11);
  });

  it('selects the nearest buffered anchor in a gap and requests its exact CostTree', async () => {
    vi.useFakeTimers();
    const { repository, calls } = createTestRepository();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useViz.setState({
      scope: 'worker',
      workerKey: makeWorkerKey(worker),
      poolRole: 'ffn',
      cursorMs: null,
      cursorNeedsSeek: false,
      operation: null,
      workerAnalysisLevel: 'iteration',
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AnalyzerRepositoryProvider repository={repository}>
          <ActiveWorkerTreeProvider
            run={run}
            workerOperationDetail={{
              status: 'ready',
              schemaVersion: 1,
              resource: { href: 'workers' },
            }}
            workerCostTreeDetail={{
              status: 'ready',
              schemaVersion: 1,
              resource: { href: 'workers' },
            }}
            analysisRevision="revision-a"
          >
            <OperationProbe />
          </ActiveWorkerTreeProvider>
        </AnalyzerRepositoryProvider>
      </QueryClientProvider>,
    );

    act(() => useViz.getState().setTime(13));
    await act(() => vi.advanceTimersByTimeAsync(150));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(useViz.getState().operation).toEqual({
      iterId: '7',
      batchId: '3',
      operationId: '0',
    });
    expect(useViz.getState().cursorMs).toBe(13);
    expect(calls.trees).toBe(1);
    expect(calls.treeWorkers).toEqual([makeWorkerKey(worker)]);
  });
});
