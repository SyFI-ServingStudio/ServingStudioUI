import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import WorkerStage from '../components/stages/WorkerStage';
import type { SubjectArtifact } from '../domain/artifacts';
import type { SubjectResult } from '../domain/subject';
import { makeWorkerKey } from '../domain/worker';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { useViz } from '../store';
import {
  createTestRepository,
  makeTestDescriptor,
  makeTestSubjectResults,
  TEST_WORKERS,
  type RepositoryCallCounts,
} from '../test/analyzerRepositoryFixture';
import { ActiveRunProvider, useActiveRunState, useActiveRunSubject } from './ActiveRunProvider';
import { analyzerQueryKeys } from './queries';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';
import {
  ActiveWorkerTreeProvider,
  useActiveWorkerTreeState,
  type WorkerTreeNonReadyStatus,
} from './WorkerTreeProvider';

const testQueryClients = new Set<QueryClient>();

const noWorkerDetail = {
  status: 'not_generated' as const,
  reason: 'No hierarchical worker detail was generated.',
};

function aggregateOnlyDescriptor(kernelTimeShare?: SubjectArtifact) {
  const base = makeTestDescriptor();
  return makeTestDescriptor({
    subjects: {
      ...base.subjects,
      kernelTimeShare: kernelTimeShare ?? base.subjects.kernelTimeShare,
    },
    details: { 'worker-cost-tree': noWorkerDetail },
  });
}

interface NonReadyCase {
  status: Exclude<WorkerTreeNonReadyStatus, 'empty'>;
  descriptorArtifact: SubjectArtifact | null;
  result: SubjectResult<'kernelTimeShare'>;
  title: string;
  role: 'alert' | 'status';
}

const nonReadyCases: readonly NonReadyCase[] = [
  {
    status: 'unavailable',
    descriptorArtifact: {
      status: 'unavailable',
      code: 'no_cost_log',
      reason: 'Cost logging was disabled.',
    },
    result: {
      subject: 'kernelTimeShare',
      status: 'unavailable',
      code: 'no_cost_log',
      reason: 'Cost logging was disabled.',
    },
    title: 'Worker evidence unavailable',
    role: 'status',
  },
  {
    status: 'not_generated',
    descriptorArtifact: { status: 'not_generated', reason: 'Analysis was not requested.' },
    result: {
      subject: 'kernelTimeShare',
      status: 'not_generated',
      reason: 'Analysis was not requested.',
    },
    title: 'Worker evidence not generated',
    role: 'status',
  },
  {
    status: 'failed',
    descriptorArtifact: {
      status: 'failed',
      code: 'analysis_failed',
      reason: 'Kernel replay failed.',
    },
    result: {
      subject: 'kernelTimeShare',
      status: 'failed',
      code: 'analysis_failed',
      reason: 'Kernel replay failed.',
    },
    title: 'Could not load aggregate worker evidence',
    role: 'alert',
  },
  {
    status: 'incompatible',
    descriptorArtifact: null,
    result: {
      subject: 'kernelTimeShare',
      status: 'incompatible',
      reason: 'Kernel-time-share schema is newer than this UI.',
      receivedSchemaVersion: 7,
    },
    title: 'Worker evidence is incompatible',
    role: 'status',
  },
];

function TreeStateProbe() {
  const state = useActiveWorkerTreeState();
  const worker = state.worker?.key ?? 'none';
  const evidence = state.evidence ?? 'none';
  return <div data-testid="worker-tree-state">{`${state.status}:${worker}:${evidence}`}</div>;
}

function ReadyRunHarness({ showWorkerStage }: { showWorkerStage: boolean }) {
  const active = useActiveRunState();
  const aggregateKernelTimeShare = useActiveRunSubject('kernelTimeShare');
  if (active.status !== 'ready') return <div data-testid="run-state">{active.status}</div>;
  return (
    <ActiveWorkerTreeProvider
      run={active.run}
      workerCostTreeDetail={active.descriptor.details['worker-cost-tree']}
      aggregateKernelTimeShare={aggregateKernelTimeShare}
      analysisRevision={active.descriptor.analysis?.revision}
    >
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
  expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none:none');
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
  it('keys worker detail by analysis revision as well as schema and composite identity', () => {
    const first = analyzerQueryKeys.workerCostTreeDetail('run', TEST_WORKERS[0], 1, 'revision-a');
    const regenerated = analyzerQueryKeys.workerCostTreeDetail(
      'run',
      TEST_WORKERS[0],
      1,
      'revision-b',
    );

    expect(first).not.toEqual(regenerated);
    expect(first).not.toEqual(
      analyzerQueryKeys.workerCostTreeDetail('run', TEST_WORKERS[1], 1, 'revision-a'),
    );
  });

  it('loads only selected composite workers and reuses cached trees', async () => {
    const { repository, calls } = createTestRepository();
    renderHarness(repository);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectPool('attn'));
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none:none');
    expect(calls.trees).toBe(0);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'ready:attn/0:hierarchical-detail',
      ),
    );
    expect(calls.treeWorkers).toEqual([makeWorkerKey(TEST_WORKERS[0])]);

    act(() => useViz.getState().selectKernel(0));
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
      'ready:attn/0:hierarchical-detail',
    );
    expect(calls.trees).toBe(1);

    act(() => useViz.getState().setCluster());
    act(() => useViz.getState().selectWorker(TEST_WORKERS[1]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'ready:ffn/0:hierarchical-detail',
      ),
    );
    expect(calls.treeWorkers).toEqual([
      makeWorkerKey(TEST_WORKERS[0]),
      makeWorkerKey(TEST_WORKERS[1]),
    ]);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'ready:attn/0:hierarchical-detail',
      ),
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
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load worker CostTree detail'),
    );
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
      'failed:ffn/0:hierarchical-detail',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('ffn tree artifact is corrupt');
    expect(screen.getByTestId('run-state')).toHaveTextContent('ready:test-run');
    expect(calls.treeWorkers).toEqual([ffnKey]);

    act(() => useViz.getState().setCluster());
    expect(screen.getByTestId('worker-tree-state')).toHaveTextContent('idle:none:none');
  });

  it('projects loaded aggregate evidence without calling the worker detail repository', async () => {
    const { repository, calls } = createTestRepository({
      descriptor: aggregateOnlyDescriptor(),
    });
    renderHarness(repository, true);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'ready:attn/0:aggregate-projection',
      ),
    );
    expect(calls.trees).toBe(0);
    expect(screen.getByText('Aggregate worker evidence only', { exact: true })).toBeVisible();
  });

  it('renders a valid zero-time worker as a neutral empty state', async () => {
    const subjects = makeTestSubjectResults();
    const kernelTimeShare = subjects.kernelTimeShare;
    if (kernelTimeShare.status !== 'ready') throw new Error('Expected ready test kernel time.');
    subjects.kernelTimeShare = {
      ...kernelTimeShare,
      payload: {
        ...kernelTimeShare.payload,
        workers: kernelTimeShare.payload.workers.map((worker) =>
          worker.key === makeWorkerKey(TEST_WORKERS[0])
            ? { ...worker, kernelTimeMs: 0, segments: [] }
            : worker,
        ),
      },
    };
    const { repository, calls } = createTestRepository({
      descriptor: aggregateOnlyDescriptor(),
      subjects,
    });
    renderHarness(repository, true);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'empty:attn/0:aggregate-projection',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('No reportable worker kernel time');
    expect(screen.getByRole('status')).toHaveTextContent('evidence status · empty');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(calls.trees).toBe(0);
  });

  it.each(nonReadyCases)(
    'preserves aggregate $status instead of collapsing it to error',
    async ({ status, descriptorArtifact, result, title, role }) => {
      const subjects = makeTestSubjectResults();
      subjects.kernelTimeShare = result;
      const { repository, calls } = createTestRepository({
        descriptor: aggregateOnlyDescriptor(descriptorArtifact ?? undefined),
        subjects,
      });
      renderHarness(repository, true);
      await expectReadyRun(calls);

      act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
      await waitFor(() =>
        expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
          `${status}:attn/0:aggregate-projection`,
        ),
      );
      expect(screen.getByRole(role)).toHaveTextContent(title);
      expect(screen.getByRole(role)).toHaveTextContent(`evidence status · ${status}`);
      expect(calls.trees).toBe(0);
    },
  );

  it('preserves a permanent hierarchical detail incompatibility without offering retry', async () => {
    const incompatible = Object.assign(new Error('Unsupported worker detail schema.'), {
      status: 'incompatible' as const,
    });
    const workerKey = makeWorkerKey(TEST_WORKERS[0]);
    const { repository, calls } = createTestRepository({
      treeErrors: { [workerKey]: incompatible },
    });
    renderHarness(repository, true);
    await expectReadyRun(calls);

    act(() => useViz.getState().selectWorker(TEST_WORKERS[0]));
    await waitFor(() =>
      expect(screen.getByTestId('worker-tree-state')).toHaveTextContent(
        'incompatible:attn/0:hierarchical-detail',
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Worker evidence is incompatible');
    expect(screen.getByRole('status')).toHaveTextContent('Unsupported worker detail schema.');
    expect(screen.queryByRole('button', { name: 'Retry worker detail' })).not.toBeInTheDocument();
  });
});
