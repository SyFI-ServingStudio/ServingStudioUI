import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ClusterStage from '../components/stages/ClusterStage';
import PoolStage from '../components/stages/PoolStage';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { useViz } from '../store';
import {
  createTestRepository,
  makeTestDescriptor,
  makeTestSubjectResults,
} from '../test/analyzerRepositoryFixture';
import { ActiveRunProvider, useActiveRunState } from './ActiveRunProvider';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';

vi.mock('../components/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

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
    await waitFor(() => expect(calls.subjects).toBe(4));
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
    await waitFor(() => expect(calls.subjects).toBe(4));
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
    await waitFor(() => expect(calls.subjects).toBe(4));
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

  it('publishes a bounded ready run without reading worker trees', async () => {
    const { repository, calls } = createTestRepository();

    renderProvider(repository);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(calls.summary).toBe(1);
    expect(calls.topology).toBe(1);
    await waitFor(() => expect(calls.subjects).toBe(5));
    expect(calls.trees).toBe(0);
  });

  it('keeps the page ready and renders an incompatible SLO payload on its card', async () => {
    const subjects = makeTestSubjectResults();
    subjects.slo = {
      subject: 'slo',
      status: 'incompatible',
      receivedSchemaVersion: 1,
      reason: 'Invalid analyzer-v1 SLO payload: ttft.x is malformed.',
    };
    const { repository } = createTestRepository({ subjects });

    renderProvider(repository, <ClusterStage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(
      await screen.findByText(
        'Analyzer subject slo is incompatible. Invalid analyzer-v1 SLO payload: ttft.x is malformed.',
      ),
    ).toBeVisible();
  });

  it('keeps the page ready and renders a missing KV artifact on its card', async () => {
    useViz.setState({ scope: 'pool', poolRole: 'attn' });
    const missingKv = Object.assign(
      new Error('KV payload is absent from the static artifact allowlist.'),
      { code: 'artifact_missing' },
    );
    const { repository } = createTestRepository({ subjectErrors: { kv: missingKv } });

    renderProvider(repository, <PoolStage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(
      await screen.findByText(
        'Analyzer subject kv is failed. [artifact_missing] KV payload is absent from the static artifact allowlist.',
      ),
    ).toBeVisible();
  });

  it('keeps the page ready and renders descriptor-declared KV unavailability', async () => {
    useViz.setState({ scope: 'pool', poolRole: 'attn' });
    const descriptor = makeTestDescriptor();
    descriptor.subjects.kv = {
      status: 'unavailable',
      code: 'missing_kv_capacity',
      reason: 'The run did not persist a usable KV capacity snapshot.',
    };
    const { repository, calls } = createTestRepository({ descriptor });

    renderProvider(repository, <PoolStage />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('ready: test-run'));
    expect(
      await screen.findByText(
        'Analyzer subject kv is unavailable. [missing_kv_capacity] The run did not persist a usable KV capacity snapshot.',
      ),
    ).toBeVisible();
    await waitFor(() => expect(calls.subjects).toBe(4));
  });
});
