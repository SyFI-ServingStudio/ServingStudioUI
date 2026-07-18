import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeWorkerKey } from '../../domain/worker';
import { useViz } from '../../store';
import WorkerAnalysisLevelControl from './WorkerAnalysisLevelControl';

beforeEach(() => {
  useViz.setState({
    scope: 'kernel',
    workerKey: makeWorkerKey('ffn', '1'),
    poolRole: 'ffn',
    workerAnalysisLevel: 'iteration',
    operation: { iterId: '7', batchId: '2', operationId: '9' },
    leafId: 4,
    parId: null,
    cursorMs: 12,
    cursorNeedsSeek: false,
  });
});

describe('WorkerAnalysisLevelControl', () => {
  it('returns from an exact kernel selection to worker aggregate', async () => {
    const user = userEvent.setup();
    render(<WorkerAnalysisLevelControl />);

    await user.click(screen.getByRole('button', { name: 'Worker' }));

    expect(useViz.getState()).toMatchObject({
      scope: 'worker',
      workerAnalysisLevel: 'worker',
      operation: null,
      leafId: null,
    });
    expect(screen.getByRole('button', { name: 'Worker' })).toHaveAttribute('aria-pressed', 'true');
  });
});
