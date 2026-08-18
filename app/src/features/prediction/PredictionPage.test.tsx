import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { annotate, leaf } from '../../domain/cost-tree';
import { useViz } from '../../store';
import PredictionPage from './PredictionPage';

const queryMocks = vi.hoisted(() => ({
  descriptor: vi.fn(),
  cases: vi.fn(),
  costTree: vi.fn(),
  kernelAnalysis: vi.fn(),
  inputDistribution: vi.fn(),
  optimality: vi.fn(),
}));

vi.mock('../../application/queries', () => ({
  usePredictionDescriptorQuery: queryMocks.descriptor,
  usePredictionCasesQuery: queryMocks.cases,
  usePredictionCostTreeQuery: queryMocks.costTree,
  usePredictionKernelAnalysisQuery: queryMocks.kernelAnalysis,
  usePredictionKernelInputDistributionQuery: queryMocks.inputDistribution,
  usePredictionOptimalityQueries: queryMocks.optimality,
}));
vi.mock('../../application/workspaceRoute', () => ({
  workspaceIdFromLocation: () => 'w_test',
}));
vi.mock('../kernel', () => ({
  KernelEvidenceView: () => <div>kernel evidence</div>,
  KernelInspectorView: () => <div>kernel inspector</div>,
}));
vi.mock('../optimality', () => ({
  OptimalityKernelLadderCard: ({ title }: { title: string }) => <div>{title}</div>,
  OptimalityKernelsCard: ({ title }: { title: string }) => <div>{title}</div>,
  OptimalityWaterfallCard: ({ title }: { title: string }) => <div>{title}</div>,
  projectExactKernelLadder: () => ({ status: 'scope_missing', reason: 'fixture' }),
  projectIterationOptimalityBreakdown: () => ({ status: 'scope_missing', reason: 'fixture' }),
}));
vi.mock('../worker/CostTreeFlow', () => ({
  CostTreeEvidence: ({ selectedLeafId }: { selectedLeafId: number | null }) => (
    <div data-testid="prediction-cost-tree-selection">{selectedLeafId ?? 'none'}</div>
  ),
}));
vi.mock('../worker/CostTreeFrame', () => ({
  COST_TREE_FRAME_HEIGHT: 400,
  CostTreeFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CostTreeStatusViewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../worker/TimeShareBlocks', () => ({
  TimeShareBlocksView: () => <div>time share</div>,
}));

const tree = annotate(leaf('model.gemm', 'single_gemm', {}, 1));

beforeEach(() => {
  window.history.replaceState(
    null,
    '',
    '#/prediction?workspace=w_test&prediction=p_test&optimalityMode=unlocked',
  );
  useViz.setState({ selectionSurface: 'aggregate', predictionSelection: null });
  queryMocks.descriptor.mockReturnValue({
    supported: true,
    isError: false,
    error: null,
    data: {
      predictionId: 'p_test',
      displayName: 'Prediction',
      selector: 'iter',
      archType: 'qwen3',
      gpu: { name: 'NVIDIA H200', count: 4 },
      caseCount: 1,
      lifecycle: { prediction: 'complete', analysis: 'complete' },
      kernelInputDistributionAvailable: false,
    },
  });
  queryMocks.cases.mockReturnValue({
    supported: true,
    isError: false,
    error: null,
    data: {
      predictionId: 'p_test',
      offset: 0,
      total: 1,
      cases: [
        {
          caseId: '0',
          input: {},
          totalTimeMs: 1,
          operations: [{ operationId: '0', section: 'iter', layer: 0, timeMs: 1 }],
        },
      ],
    },
  });
  queryMocks.costTree.mockReturnValue({
    isError: false,
    error: null,
    data: {
      predictionId: 'p_test',
      caseId: '0',
      operationId: '0',
      section: 'iter',
      layer: 0,
      interval: { startMs: 0, endMs: 1 },
      inputs: [],
      tree,
    },
  });
  queryMocks.kernelAnalysis.mockReturnValue({ data: undefined, isError: false, error: null });
  queryMocks.inputDistribution.mockReturnValue({ data: undefined, isError: false, error: null });
  queryMocks.optimality.mockReturnValue({
    ladder: { data: undefined, isError: false, error: null },
    waterfall: { data: undefined, isError: false, error: null },
  });
});

describe('PredictionPage selection defaults', () => {
  it('selects the first case and operation without implicitly selecting a kernel', async () => {
    render(<PredictionPage predictionId="p_test" />);

    await waitFor(() => {
      expect(useViz.getState().predictionSelection).toMatchObject({
        caseId: '0',
        operationId: '0',
        leafId: null,
      });
    });
    expect(screen.getByTestId('prediction-cost-tree-selection')).toHaveTextContent('none');
    expect(window.location.hash).not.toContain('leaf=');
    expect(queryMocks.kernelAnalysis).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Number),
    );
  });
});
