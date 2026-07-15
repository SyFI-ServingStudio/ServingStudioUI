import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { useViz } from '../store';
import { createTestRepository, makeTestDescriptor } from '../test/analyzerRepositoryFixture';
import { ActiveRunProvider, useActiveRunState } from './ActiveRunProvider';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';

const testQueryClients = new Set<QueryClient>();

function StateProbe() {
  const state = useActiveRunState();
  const detail = state.status === 'ready' ? state.run.id : state.error?.message;
  return <div role="status">{state.status}{detail ? `: ${detail}` : ''}</div>;
}

function renderProvider(repository: AnalyzerRepository) {
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
          <StateProbe />
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useViz.setState({
    runId: null,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    focus: null,
  });
});

afterEach(() => {
  for (const queryClient of testQueryClients) queryClient.clear();
  testQueryClients.clear();
});

describe('ActiveRunProvider', () => {
  it('keeps a pending analyzer lifecycle in loading without reading artifacts', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'complete', analysis: 'pending' },
    });
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(calls.descriptor).toBe(1));
    expect(screen.getByRole('status')).toHaveTextContent(/^loading$/);
    expect(calls.summary).toBe(0);
    expect(calls.subjects).toBe(0);
    expect(calls.trees).toBe(0);
  });

  it('treats a pending required subject as a completion barrier', async () => {
    const descriptor = makeTestDescriptor();
    descriptor.subjects.slo = { status: 'pending', reason: 'SLO aggregation is running.' };
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(calls.descriptor).toBe(1));
    expect(screen.getByRole('status')).toHaveTextContent(/^loading$/);
    expect(calls.summary).toBe(0);
    expect(calls.subjects).toBe(0);
  });

  it('surfaces a failed lifecycle and does not issue artifact reads', async () => {
    const descriptor = makeTestDescriptor({
      lifecycle: { simulation: 'complete', analysis: 'failed' },
    });
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'error: Analyzer analysis stage failed for test-run.',
    ));
    expect(calls.summary).toBe(0);
    expect(calls.subjects).toBe(0);
  });

  it('publishes a ready run only after all required artifacts are assembled', async () => {
    const { repository, calls } = createTestRepository();

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(calls.summary).toBe(1);
    expect(calls.topology).toBe(1);
    expect(calls.subjects).toBe(10);
    expect(calls.trees).toBe(2);
  });
});
