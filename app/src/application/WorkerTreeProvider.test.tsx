import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import WorkerStage from '../components/stages/WorkerStage';
import { makeWorkerKey } from '../domain/worker';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { useViz } from '../store';
import {
  createTestRepository,
  TEST_WORKERS,
  type RepositoryCallCounts,
} from '../test/analyzerRepositoryFixture';
import { ActiveRunProvider, useActiveRunState } from './ActiveRunProvider';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';
import { ActiveWorkerTreeProvider, useActiveWorkerTreeState } from './WorkerTreeProvider';

const testQueryClients = new Set<QueryClient>();

function TreeStateProbe() {
  const state = useActiveWorkerTreeState();
  const worker = state.worker?.key ?? 'none';
  return <div data-testid="worker-tree-state">{`${state.status}:${worker}`}</div>;
}

function ReadyRunHarness({ showWorkerStage }: { showWorkerStage: boolean }) {
  const active = useActiveRunState();
  if (active.status !== 'ready') return <div data-testid="run-state">{active.status}</div>;
  const kernelTimeShare = active.data.subjects.kernelTimeShare;
  const schemaVersion =
    kernelTimeShare.status === 'ready' ? kernelTimeShare.schemaVersion : undefined;
  return (
    <ActiveWorkerTreeProvider run={active.run} schemaVersion={schemaVersion}>
      <div data-testid="run-state">ready:{active.run.id}</div>
      <TreeStateProbe />
      {showWorkerStage ? <WorkerStage /> : null}
    </ActiveWorkerTreeProvider>
  );
}

function renderHarness(repository: AnalyzerRepository, showWorkerStage = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  testQueryClients.add(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyzerRepositoryProvider repository={repository}>
        <ActiveRunProvider>
          <ReadyRunHarness showWorkerStage={showWorkerStage} />
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
}

async function expectReadyRun(calls: RepositoryCallCounts) {
  await waitFor(() => expect(screen.getByTestId('run-state')).toHaveTextContent('ready:test-run'));
  expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none');
  expect(calls.trees).toBe(0);
}

beforeEach(() => {
  useViz.setState({
    runId: null,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    focus: null,
  });
});

afterEach(() => {
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
});

describe('ActiveWorkerTreeProvider', () => {
  it('loads only selected composite workers and reuses cached trees', async () => {
    const { repository, calls } = createTestRepository();
    renderHarness(repository);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectPool('attn'));
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none');
    expect(calls.trees).toBe(0);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('ready:attn/0'),
    );
    expect(calls.treeWorkers).toEqual([makeWorkerKey(TEST_WORKERS[0])]);

    act(() => useViz.getState().selectKernel(0));
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('ready:attn/0');
    expect(calls.trees).toBe(1);

    act(() => useViz.getState().setCluster());
    act(() => useViz.getState().selectWorker(TEST_WORKERS[1]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('ready:ffn/0'),
    );
    expect(calls.treeWorkers).toEqual([
      makeWorkerKey(TEST_WORKERS[0]),
      makeWorkerKey(TEST_WORKERS[1]),
    ]);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('ready:attn/0'),
    );
    expect(calls.trees).toBe(2);
  });

  it('keeps the run ready and shows a local worker-stage error', async () => {
    const ffnKey = makeWorkerKey(TEST_WORKERS[1]);
    const { repository, calls } = createTestRepository({
      treeErrors: { [ffnKey]: new Error('ffn tree artifact is corrupt') },
    });
    renderHarness(repository, true);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[1]));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load worker cost tree'),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('ffn tree artifact is corrupt');
    expect(screen.getByTestId('run-state')).toHaveTextContent('ready:test-run');
    expect(calls.treeWorkers).toEqual([ffnKey]);

    act(() => useViz.getState().setCluster());
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none');
  });
});
