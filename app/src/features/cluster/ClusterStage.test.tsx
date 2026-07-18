import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveRunProvider, useActiveRunState } from '../../application/ActiveRunProvider';
import { AnalyzerRepositoryProvider } from '../../application/RepositoryProvider';
import { ChartFocusProvider } from '../../components/ChartFocusProvider';
import { makeWorkerKey, makeWorkerRef } from '../../domain/worker';
import type { AnalyzerRepository } from '../../repositories/AnalyzerRepository';
import { createTestRepository, makeTestSubjectResults } from '../../test/analyzerRepositoryFixture';
import ClusterStage from './ClusterStage';

vi.mock('../../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const testQueryClients = new Set<QueryClient>();

function ReadyGate({ children }: { children: ReactNode }) {
  const state = useActiveRunState();
  return state.status === 'ready' ? children : null;
}

function renderStage(repository: AnalyzerRepository) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  testQueryClients.add(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyzerRepositoryProvider repository={repository}>
        <ActiveRunProvider>
          <ChartFocusProvider>
            <ReadyGate>
              <ClusterStage />
            </ReadyGate>
          </ChartFocusProvider>
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
});

describe('ClusterStage', () => {
  it('renders an incompatible SLO payload on its own card', async () => {
    const subjects = makeTestSubjectResults();
    subjects.slo = {
      subject: 'slo',
      status: 'incompatible',
      receivedSchemaVersion: 1,
      reason: 'Invalid analyzer-v1 SLO payload: ttft.x is malformed.',
    };
    const { repository } = createTestRepository({ subjects });

    renderStage(repository);

    expect(
      await screen.findAllByText(
        'Analyzer subject slo is incompatible. Invalid analyzer-v1 SLO payload: ttft.x is malformed.',
      ),
    ).toHaveLength(3);
  });

  it('renders ready TTFT, TPOT and E2E as three separate charts', async () => {
    const { repository } = createTestRepository();

    renderStage(repository);

    expect(await screen.findByRole('img', { name: /TTFT latency/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /TPOT latency/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /E2E latency/ })).toBeVisible();
  });

  it('renders one cluster utilization chart for every payload pool', async () => {
    const subjects = makeTestSubjectResults();
    subjects.utilization = {
      subject: 'utilization',
      status: 'ready',
      schemaVersion: 1,
      payload: {
        t_ms: [0],
        series: [
          { key: 'pool_0', label: 'Pool 0', poolTag: 'attn', util: [0.5] },
          { key: 'pool_1', label: 'Pool 1', poolTag: 'ffn', util: [0.75] },
        ],
        workerSeries: [
          {
            key: makeWorkerKey('attn', '0'),
            label: 'Worker 0',
            worker: makeWorkerRef('attn', '0'),
            util: [0.5],
          },
          {
            key: makeWorkerKey('ffn', '0'),
            label: 'Worker 0',
            worker: makeWorkerRef('ffn', '0'),
            util: [0.75],
          },
        ],
      },
    };
    const { repository } = createTestRepository({ subjects });

    renderStage(repository);

    expect(await screen.findByText('GPU utilization · all pools')).toBeVisible();
    expect(await screen.findByText('2 worker lines · 2 pool averages')).toBeVisible();
    expect(screen.queryByText('GPU utilization · attn')).not.toBeInTheDocument();
  });

  it('places request state immediately before the closing kernel breakdown', async () => {
    const { repository } = createTestRepository();
    renderStage(repository);

    const requestState = await screen.findByText('Request state');
    const kernelBreakdown = screen.getByText('Cluster kernel time breakdown');
    expect(requestState.compareDocumentPosition(kernelBreakdown)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
