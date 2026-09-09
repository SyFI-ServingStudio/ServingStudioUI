import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { createTestRepository, makeTestDescriptor } from '../test/analyzerRepositoryFixture';
import { ActiveRunProvider, useActiveRunState, useActiveRunSubject } from './ActiveRunProvider';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';

const testQueryClients = new Set<QueryClient>();

function StateProbe() {
  const state = useActiveRunState();
  const detail = state.status === 'ready' ? state.run.id : state.error?.message;
  return (
    <div role="status">
      {state.status}
      {detail ? `: ${detail}` : ''}
    </div>
  );
}

function ReadyGate({ children }: { children?: ReactNode }) {
  const state = useActiveRunState();
  return (
    <>
      <StateProbe />
      {state.status === 'ready' ? children : null}
    </>
  );
}

function SloSubjectProbe() {
  const slo = useActiveRunSubject('slo');
  return <div data-testid="slo-subject">{slo.status}</div>;
}

function renderProvider(repository: AnalyzerRepository, readyChildren?: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Infinite GC avoids leaving cache-collection timers behind in jsdom.
      queries: { retry: false, gcTime: Infinity },
    },
  });
  testQueryClients.add(queryClient);
  return render(
    <QueryClientProvider client={queryClient}>
      <AnalyzerRepositoryProvider repository={repository}>
        <ActiveRunProvider>
          <ReadyGate>{readyChildren}</ReadyGate>
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
});

describe('ActiveRunProvider', () => {
  it('publishes the bounded core while analysis is pending', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'complete', analysis: 'pending' },
    });
    descriptor.subjects.slo = { status: 'pending', reason: 'Analysis is running.' };
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(calls.summary).toBe(1);
    expect(calls.topology).toBe(1);
    expect(calls.subjects).toBe(0);
    expect(calls.trees).toBe(0);
  });

  it('publishes the core while one optional subject remains pending', async () => {
    const descriptor = makeTestDescriptor();
    descriptor.subjects.slo = { status: 'pending', reason: 'SLO aggregation is running.' };
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(calls.summary).toBe(1);
    expect(calls.topology).toBe(1);
    expect(calls.subjects).toBe(0);
  });

  it('keeps the bounded core available when analysis failed', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'complete', analysis: 'failed' },
    });
    descriptor.subjects.slo = {
      status: 'failed',
      code: 'analysis_failed',
      reason: 'SLO aggregation failed.',
    };
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(calls.summary).toBe(1);
    expect(calls.topology).toBe(1);
    expect(calls.subjects).toBe(0);
  });

  it('keeps an incomplete simulation as the core lifecycle barrier', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'pending', analysis: 'not_started' },
    });
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(calls.descriptor).toBe(1));
    expect(screen.getByRole('status')).toHaveTextContent(/^loading$/);
    expect(calls.summary).toBe(0);
    expect(calls.subjects).toBe(0);
  });

  it('surfaces a failed simulation without reading core artifacts', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'failed', analysis: 'not_started' },
    });
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'error: Simulation stage failed for test-run.',
      ),
    );
    expect(calls.summary).toBe(0);
    expect(calls.topology).toBe(0);
    expect(calls.subjects).toBe(0);
  });

  it('loads only a subject whose consumer is mounted', async () => {
    const { repository, calls } = createTestRepository();

    renderProvider(repository, <SloSubjectProbe />);

    await waitFor(() => expect(screen.getByTestId('slo-subject')).toHaveTextContent('ready'));
    expect(calls.subjects).toBe(1);
  });
});
