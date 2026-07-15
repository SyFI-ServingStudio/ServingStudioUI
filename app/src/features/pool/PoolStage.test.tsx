import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveRunProvider, useActiveRunState } from '../../application/ActiveRunProvider';
import { AnalyzerRepositoryProvider } from '../../application/RepositoryProvider';
import { ChartFocusProvider } from '../../components/ChartFocusProvider';
import type { AnalyzerRepository } from '../../repositories/AnalyzerRepository';
import { useViz } from '../../store';
import { createTestRepository, makeTestDescriptor } from '../../test/analyzerRepositoryFixture';
import PoolStage from './PoolStage';

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
              <PoolStage />
            </ReadyGate>
          </ChartFocusProvider>
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useViz.setState({ scope: 'pool', poolRole: 'attn' });
});

afterEach(() => {
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
});

describe('PoolStage', () => {
  it('renders an artifact fetch failure on the KV card', async () => {
    const missingKv = Object.assign(
      new Error('KV payload is absent from the static artifact allowlist.'),
      { code: 'artifact_missing' },
    );
    const { repository } = createTestRepository({ subjectErrors: { kv: missingKv } });

    renderStage(repository);

    expect(
      await screen.findByText(
        'Analyzer subject kv is failed. [artifact_missing] KV payload is absent from the static artifact allowlist.',
      ),
    ).toBeVisible();
  });

  it('renders descriptor-declared KV unavailability without fetching that subject', async () => {
    const descriptor = makeTestDescriptor();
    descriptor.subjects.kv = {
      status: 'unavailable',
      code: 'missing_kv_capacity',
      reason: 'The run did not persist a usable KV capacity snapshot.',
    };
    const { repository, calls } = createTestRepository({ descriptor });

    renderStage(repository);

    expect(
      await screen.findByText(
        'Analyzer subject kv is unavailable. [missing_kv_capacity] The run did not persist a usable KV capacity snapshot.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(calls.subjects).toBe(2));
  });
});
