import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf } from '../../domain/cost-tree';
import { makeWorkerKey } from '../../domain/worker';
import { useViz } from '../../store';
import OptimalityAnalysisStage from './OptimalityAnalysisStage';

const mocks = vi.hoisted(() => ({
  worker: {
    key: 'attn/0',
    ref: { poolTag: 'attn', workerId: '0' },
    id: '0',
    pool: 'attn',
  },
  treeState: vi.fn(),
  iterationQuery: vi.fn(),
}));
const workerKey = makeWorkerKey('attn', '0');
const worker = { ...mocks.worker, key: workerKey };
const tree = annotate(leaf('afd.attn.prefill', 'paged_attention', {}, 1));

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRunState: () => ({
    status: 'ready',
    run: { id: 'run', workerList: [mocks.worker] },
    descriptor: {
      details: { 'iteration-optimality-kernel-ladder': { status: 'ready' } },
      analysis: { revision: 'revision' },
    },
  }),
  useActiveRunSubject: () => ({ status: 'not_generated', reason: 'Not generated.' }),
}));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: mocks.treeState,
}));

vi.mock('../../application/queries', () => ({
  useIterationOptimalityKernelLadderQuery: mocks.iterationQuery,
}));

vi.mock('../metrics', () => ({
  OptimalityBreakdownCard: ({ title }: { title: string }) => <div>{title}</div>,
  OptimalityKernelLadderCard: ({ title }: { title: string }) => <div>{title}</div>,
  OptimalityKernelsCard: ({ title }: { title: string }) => <div>{title}</div>,
  projectAggregateKernelLadder: () => ({ status: 'scope_missing', reason: 'fixture' }),
  projectExactKernelLadder: () => ({ status: 'scope_missing', reason: 'fixture' }),
}));

beforeEach(() => {
  mocks.treeState.mockReturnValue({ status: 'idle', worker: null, tree: null });
  mocks.iterationQuery.mockReturnValue({
    supported: true,
    data: {},
    error: null,
    isError: false,
  });
  useViz.setState({
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    operation: null,
    leafId: null,
  });
});

describe('OptimalityAnalysisStage', () => {
  it('renders the three cluster optimality views together', () => {
    render(<OptimalityAnalysisStage />);

    expect(screen.getByText('Cluster optimality waterfall')).toBeVisible();
    expect(screen.getByText('Cluster kernel optimality ladder')).toBeVisible();
    expect(screen.getByText('Cluster per-kernel optimality')).toBeVisible();
  });

  it('switches the dedicated section to the selected pool', () => {
    useViz.setState({ scope: 'pool', poolRole: 'attn' });
    render(<OptimalityAnalysisStage />);

    expect(screen.getByText('Pool optimality waterfall · attn')).toBeVisible();
    expect(screen.getByText('Pool per-kernel optimality · attn')).toBeVisible();
  });

  it('uses exact iteration data and then filters to a selected kernel leaf', () => {
    useViz.setState({
      scope: 'kernel',
      poolRole: 'attn',
      workerKey,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      leafId: tree.id,
    });
    mocks.treeState.mockReturnValue({
      status: 'ready',
      worker,
      operation: { iterId: '7', batchId: '2', operationId: '9' },
      tree,
    });
    render(<OptimalityAnalysisStage />);

    expect(screen.getByText('Kernel optimality ladder · afd.attn.prefill')).toBeVisible();
    expect(screen.getByText('Kernel optimality sources · afd.attn.prefill')).toBeVisible();
    expect(mocks.iterationQuery).toHaveBeenCalledWith('run', worker.ref, '7', 'revision', true);
  });
});
