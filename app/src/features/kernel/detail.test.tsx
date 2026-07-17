import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf, leafByName, max, sum } from '../../domain/cost-tree';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import { useViz } from '../../store';
import KernelInspector, { KernelEvidence } from './KernelDetail';
import ParallelDetail from './ParallelDetail';

const fixture = vi.hoisted(() => ({ subject: vi.fn(), treeState: vi.fn() }));
const worker = makeWorkerRef('attn', '0');
const workerKey = makeWorkerKey(worker);
const tree = annotate(
  sum(
    'root',
    max(
      'attention branches',
      1,
      leaf(
        'attention.prefill',
        'flashinfer_attn_prefill',
        {
          backends: ['deepgemm'],
          gpu_name: 'NVIDIA H200',
          n: { value: 151936, expression: 'hidden/tp', bindings: { hidden: 607744, tp: 4 } },
          k: { value: 6144, expression: null, bindings: {} },
          dtype: 'fp8_e4m3',
        },
        3,
        'fa3',
        {
          input: { m: 1330 },
          flops: 2_483_096_125_440,
          bytes: 1_345_816_064,
          tflops: 1276.565,
          gbps: 691.887,
        },
      ),
      leaf('attention.decode', 'flashinfer_attn_decode', {}, 1, 'fa3'),
    ),
    leaf('ffn.gemm', 'single_gemm', {}, 2, 'cutlass'),
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
  fixture.treeState.mockReturnValue({ status: 'ready', tree });
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

    render(
      <>
        <KernelInspector height={723} />
        <KernelEvidence />
      </>,
    );

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Execution' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Performance' })).toBeVisible();
    expect(screen.getByText('Aggregate sampled throughput')).toBeVisible();
    expect(screen.getByText(/2\.0 TFLOP\/s · p50/)).toBeVisible();
    expect(screen.getByText('Kernel input distribution')).toBeVisible();
    expect(screen.getByText('Input scatter was not requested.')).toBeVisible();
    expect(screen.getByText('Backends')).toBeVisible();
    expect(screen.getByText('deepgemm')).toBeVisible();
    expect(screen.getByText('GPU')).toBeVisible();
    expect(screen.getByText('NVIDIA H200')).toBeVisible();
    expect(screen.getByText('hidden/tp = 151,936')).toBeVisible();
    expect(screen.getByText('6,144')).toBeVisible();
    expect(screen.getByText('FP8 E4M3')).toBeVisible();
    expect(screen.getByText('M')).toBeVisible();
    expect(screen.getByText('1,330')).toBeVisible();
    expect(screen.getByText('2.48 TFLOP')).toBeVisible();
    expect(screen.getByText('1.35 GB')).toBeVisible();
    expect(screen.getByText('1.28 PFLOP/s')).toBeVisible();
    expect(screen.getByText('692 GB/s')).toBeVisible();
    expect(screen.queryByText(/roofline/i)).not.toBeInTheDocument();
    const inspector = screen.getByTestId('kernel-inspector');
    const cards = screen.getByTestId('kernel-detail-cards');
    expect(inspector).toHaveStyle({ height: '723px', display: 'flex' });
    expect(cards).toHaveStyle({
      gridTemplateColumns: 'minmax(0,1fr)',
      minHeight: '0',
      overflowY: 'auto',
      overflowX: 'hidden',
    });
    expect(inspector).toContainElement(screen.getByRole('heading', { name: 'Overview' }));
    expect(inspector).toContainElement(screen.getByRole('heading', { name: 'Execution' }));
    expect(inspector).toContainElement(screen.getByRole('heading', { name: 'Performance' }));
    expect(inspector).not.toContainElement(screen.getByText('Aggregate sampled throughput'));
    expect(inspector.contains(screen.getByTestId('kernel-evidence'))).toBe(false);
  });

  it('shows pure Max critical-path facts without inventing lane imbalance', () => {
    useViz.setState({ scope: 'parallel', parId: parallel.id });

    render(<ParallelDetail />);

    expect(screen.getByText(/pure Max · critical path/)).toBeVisible();
    expect(screen.getByText('attention.prefill')).toBeVisible();
    expect(screen.getByText('Load-imbalance detail not generated')).toBeVisible();
    expect(screen.queryByText(/straggler lane/i)).not.toBeInTheDocument();
  });

  it('renders backend counts, ratios, and the selected-position projection', () => {
    fixture.subject.mockImplementation((name: string) =>
      name === 'kernelInputDistribution'
        ? {
            subject: name,
            status: 'ready',
            schemaVersion: 1,
            payload: {
              positions: [
                {
                  name: 'attention.prefill',
                  kind: 'flashinfer_attn_prefill',
                  candidateBackends: ['fa2', 'fa3'],
                  selection: [
                    { backendIndex: 0, backendName: 'fa2', count: 3, ratio: 0.75 },
                    { backendIndex: 1, backendName: 'fa3', count: 1, ratio: 0.25 },
                  ],
                  projection: 'raw_2d',
                  axisLabels: ['batch_size', 'total_tokens'],
                  explainedVariance: null,
                  points: [
                    { x: 2, y: 128, backendIndex: 0, backendName: 'fa2', count: 3 },
                    { x: 4, y: 512, backendIndex: 1, backendName: 'fa3', count: 1 },
                  ],
                },
              ],
              sampling: { stride: 2, sampledRows: 8, maxPointsPerPosition: 6000 },
              definitions: {},
            },
          }
        : { subject: name, status: 'not_generated', reason: 'No throughput.' },
    );
    useViz.setState({ scope: 'kernel', leafId: selectedLeaf.id });

    render(<KernelEvidence />);

    expect(screen.getByTestId('kernel-input-distribution')).toBeVisible();
    expect(screen.getByText('fa2')).toBeVisible();
    expect(screen.getByText('3 · 75.0%')).toBeVisible();
    expect(screen.getByText('fa3')).toBeVisible();
    expect(screen.getByText('1 · 25.0%')).toBeVisible();
    expect(
      screen.getByRole('img', {
        name: 'Kernel input projection for attention.prefill, colored by selected backend.',
      }),
    ).toBeVisible();
  });

  it('preserves an available-false payload as unavailable evidence', () => {
    fixture.subject.mockImplementation((name: string) =>
      name === 'kernelInputDistribution'
        ? {
            subject: name,
            status: 'unavailable',
            reason: 'This run predates the slot_backend column.',
          }
        : { subject: name, status: 'not_generated', reason: 'No throughput.' },
    );
    useViz.setState({ scope: 'kernel', leafId: selectedLeaf.id });

    render(<KernelEvidence />);

    expect(screen.getByText('This run predates the slot_backend column.')).toBeVisible();
    expect(screen.getByText('evidence status · unavailable')).toBeVisible();
  });
});
