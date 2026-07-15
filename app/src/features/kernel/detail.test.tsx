import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, leafByName, max, sum } from '../../domain/cost-tree';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import { useViz } from '../../store';
import KernelDetail from './KernelDetail';
import ParallelDetail from './ParallelDetail';

const fixture = vi.hoisted(() => ({ subject: vi.fn(), treeState: vi.fn() }));
const worker = makeWorkerRef('attn', '0');
const workerKey = makeWorkerKey(worker);
const tree = annotate(
  sum(
    'root',
    max(
      'attention branches',
      leaf('attention.prefill', 'flashinfer_attn_prefill', '{}', 3, 'fa3'),
      leaf('attention.decode', 'flashinfer_attn_decode', '{}', 1, 'fa3'),
    ),
    leaf('ffn.gemm', 'single_gemm', '{}', 2, 'cutlass'),
  ),
);
if (tree.kind !== 'sum' || tree.children[0].kind !== 'max') {
  throw new Error('Kernel detail test fixture has an invalid shape.');
}
const parallel = tree.children[0];
const selectedLeaf = leafByName(tree, 'attention.prefill');
if (selectedLeaf === null) throw new Error('Kernel detail test fixture has no selected leaf.');

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRun: () => ({
    id: 'run',
    workerList: [
      {
        key: 'attn/0',
        ref: { poolTag: 'attn', workerId: '0' },
        id: '0',
        pool: 'attn',
      },
    ],
  }),
  useActiveRunSubject: fixture.subject,
}));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerTreeState: fixture.treeState,
}));

beforeEach(() => {
  fixture.treeState.mockReturnValue({ status: 'ready', evidence: 'hierarchical-detail', tree });
  fixture.subject.mockImplementation((name: string) =>
    name === 'kernelThroughput'
      ? {
          subject: name,
          status: 'ready',
          schemaVersion: 1,
          payload: {
            locations: [
              {
                name: 'attention.prefill',
                kind: 'flashinfer_attn_prefill',
                tflops: { sampleCount: 4, mean: 2, p50: 2, p90: 3, p99: 3, max: 3 },
                gbps: { sampleCount: 4, mean: 4, p50: 4, p90: 5, p99: 5, max: 5 },
              },
            ],
            sampling: {
              stride: 1,
              sampledRows: 4,
              sampledComputeSlots: 4,
              sampledMemorySlots: 4,
            },
            units: { tflops: 'TFLOP/s', gbps: 'GB/s' },
            definitions: {},
          },
        }
      : {
          subject: name,
          status: 'not_generated',
          reason: 'Input scatter was not requested.',
        },
  );
  useViz.setState({
    scope: 'worker',
    workerKey,
    poolRole: 'attn',
    leafId: null,
    parId: null,
  });
});

describe('kernel feature evidence boundaries', () => {
  it('combines CostTree leaf facts with exact real throughput and an explicit missing input state', () => {
    useViz.setState({ scope: 'kernel', leafId: selectedLeaf.id });

    render(<KernelDetail />);

    expect(screen.getByText('Aggregate sampled throughput')).toBeVisible();
    expect(screen.getByText(/2\.0 TFLOP\/s · p50/)).toBeVisible();
    expect(screen.getByText('Kernel input distribution')).toBeVisible();
    expect(screen.getByText('Input scatter was not requested.')).toBeVisible();
    expect(screen.queryByText(/H200|roofline/i)).not.toBeInTheDocument();
  });

  it('shows pure Max critical-path facts without inventing lane imbalance', () => {
    useViz.setState({ scope: 'parallel', parId: parallel.id });

    render(<ParallelDetail />);

    expect(screen.getByText(/pure Max · critical path/)).toBeVisible();
    expect(screen.getByText('attention.prefill')).toBeVisible();
    expect(screen.getByText('Load-imbalance detail not generated')).toBeVisible();
    expect(screen.queryByText(/straggler lane/i)).not.toBeInTheDocument();
  });
});
