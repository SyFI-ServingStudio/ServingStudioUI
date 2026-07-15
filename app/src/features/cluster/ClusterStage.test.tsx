import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveRunProvider, useActiveRunState } from '../../application/ActiveRunProvider';
import { AnalyzerRepositoryProvider } from '../../application/RepositoryProvider';
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
          <ReadyGate>
            <ClusterStage />
          </ReadyGate>
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
      await screen.findByText(
        'Analyzer subject slo is incompatible. Invalid analyzer-v1 SLO payload: ttft.x is malformed.',
      ),
    ).toBeVisible();
  });
});
