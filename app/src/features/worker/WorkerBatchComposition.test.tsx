import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkerKey } from '../../domain/worker';
import WorkerBatchComposition from './WorkerBatchComposition';

const mocks = vi.hoisted(() => ({ workerKind: 'afd_ffn' as 'afd_attn' | 'afd_ffn' | 'iterwise' }));
const workerKey = makeWorkerKey('ffn', '1');

vi.mock('../../application/ActiveRunProvider', () => ({
  useActiveRunSubject: () => ({
    status: 'ready',
    payload: {
      workers: [
        {
          key: workerKey,
          t_ms: [0],
          batchTokens: [32],
          prefillTokens: [0],
          decodeRequests: [0],
        },
      ],
    },
  }),
}));

vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerOperationState: () => ({
    status: 'ready',
    viewport: { buffer: { workerKind: mocks.workerKind } },
  }),
}));

vi.mock('../../store', () => ({
  useViz: () => null,
}));

vi.mock('../../components/ChartCard', () => ({
  default: ({ title, option, empty }: { title: string; option: unknown; empty?: string }) => (
    <div data-testid="batch-card">
      <span>{title}</span>
      <span>{option ? 'chart' : 'no chart'}</span>
      {empty && <span>{empty}</span>}
    </div>
  ),
}));

describe('WorkerBatchComposition', () => {
  beforeEach(() => {
    mocks.workerKind = 'afd_ffn';
  });

  it('shows only the routed total for an FFN worker', () => {
    render(<WorkerBatchComposition workerKey={workerKey} />);

    const cards = screen.getAllByTestId('batch-card');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Total batch tokens');
    expect(cards[0]).toHaveTextContent('chart');
    expect(cards[1]).toHaveTextContent('Prefill tokens');
    expect(cards[1]).toHaveTextContent('no chart');
    expect(cards[2]).toHaveTextContent('Decode requests');
    expect(cards[2]).toHaveTextContent('no chart');
    expect(screen.getAllByText(/FFN cost logs retain only routed total tokens/)).toHaveLength(2);
  });

  it('shows all three signals for an attention worker', () => {
    mocks.workerKind = 'afd_attn';
    render(<WorkerBatchComposition workerKey={workerKey} />);

    for (const card of screen.getAllByTestId('batch-card')) {
      expect(card).toHaveTextContent('chart');
      expect(card).not.toHaveTextContent('no chart');
    }
  });
});
