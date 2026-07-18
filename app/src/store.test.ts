import { beforeEach, describe, expect, it } from 'vitest';

import type { OperationSummary } from './domain/workerOperation';
import { makeWorkerKey } from './domain/worker';
import { useViz } from './store';

const operation: OperationSummary = {
  ordinal: 3,
  ref: { iterId: '7', batchId: '2', operationId: '9' },
  section: 'post_attn',
  layer: 51,
  startMs: 12,
  endMs: 13,
};

beforeEach(() => {
  useViz.setState({
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    cursorNeedsSeek: false,
    operation: null,
    workerAnalysisLevel: 'worker',
  });
});

describe('worker analysis level', () => {
  it('selects a worker at aggregate level while preserving only the free cursor', () => {
    useViz.setState({ cursorMs: 120 });

    useViz.getState().selectWorker({ poolTag: 'ffn', workerId: '1' });

    expect(useViz.getState()).toMatchObject({
      scope: 'worker',
      workerKey: makeWorkerKey('ffn', '1'),
      workerAnalysisLevel: 'worker',
      cursorMs: 120,
      cursorNeedsSeek: false,
      operation: null,
    });
  });

  it('enters iteration mode, resolves the cursor, then returns atomically to worker aggregate', () => {
    useViz.setState({
      scope: 'worker',
      workerKey: makeWorkerKey('ffn', '1'),
      poolRole: 'ffn',
      cursorMs: 120,
    });

    useViz.getState().showIterationAnalysis();
    expect(useViz.getState()).toMatchObject({
      workerAnalysisLevel: 'iteration',
      cursorNeedsSeek: true,
    });

    useViz.getState().selectOperation(operation);
    useViz.getState().selectKernel(4);
    useViz.getState().showWorkerAnalysis();
    expect(useViz.getState()).toMatchObject({
      scope: 'worker',
      workerAnalysisLevel: 'worker',
      operation: null,
      leafId: null,
      parId: null,
      cursorNeedsSeek: false,
    });
  });
});
