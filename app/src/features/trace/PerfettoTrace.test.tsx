import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActiveRunProvider, useActiveRunState } from '../../application/ActiveRunProvider';
import type { RunDescriptor } from '../../domain/artifacts';
import { AnalyzerRepositoryProvider } from '../../application/RepositoryProvider';
import { useViz } from '../../store';
import { createTestRepository, makeTestDescriptor } from '../../test/analyzerRepositoryFixture';
import { PERFETTO_ORIGIN } from './perfettoBridge';
import PerfettoTrace from './PerfettoTrace';

const queryClients = new Set<QueryClient>();

function ReadyHarness() {
  const activeRun = useActiveRunState();
  if (activeRun.status !== 'ready') return <div data-testid="run-state">{activeRun.status}</div>;
  return <PerfettoTrace />;
}

function renderTrace(descriptor: RunDescriptor) {
  const { repository } = createTestRepository({ descriptor });
  const getTrace = vi.spyOn(repository, 'getTrace');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClients.add(queryClient);
  render(
    <QueryClientProvider client={queryClient}>
      <AnalyzerRepositoryProvider repository={repository}>
        <ActiveRunProvider>
          <ReadyHarness />
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>,
  );
  return getTrace;
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
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const queryClient of queryClients) queryClient.clear();
  queryClients.clear();
});

describe('PerfettoTrace', () => {
  it('keeps unavailable traces local to the card and never asks for bytes', async () => {
    const getTrace = renderTrace(makeTestDescriptor());

    expect(await screen.findByText('Execution trace')).toBeInTheDocument();
    expect(screen.getByText('Not requested.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: 'Open trace ▸' })).toBeDisabled();
    expect(getTrace).not.toHaveBeenCalled();
  });

  it('loads the selected run trace lazily and posts it only to the Perfetto origin', async () => {
    const descriptor = makeTestDescriptor({
      traces: {
        perfetto: {
          status: 'ready',
          artifact: {
            href: '/api/v1/runs/test-run/traces/perfetto',
            mediaType: 'application/gzip',
          },
        },
      },
    });
    const fetchTrace = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const getTrace = renderTrace(descriptor);

    const open = await screen.findByRole('button', { name: 'Open trace ▸' });
    expect(getTrace).not.toHaveBeenCalled();
    fireEvent.click(open);

    await waitFor(() => expect(getTrace).toHaveBeenCalledWith('test-run', 'perfetto'));
    const iframe = await screen.findByTitle('Perfetto trace for Test run');
    if (!(iframe instanceof HTMLIFrameElement)) throw new Error('Expected a Perfetto iframe.');
    const perfettoWindow = iframe.contentWindow;
    if (perfettoWindow === null) throw new Error('Expected the Perfetto iframe window.');
    const postMessage = vi.spyOn(perfettoWindow, 'postMessage');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'PONG',
        origin: 'https://untrusted.example',
        source: perfettoWindow,
      }),
    );
    expect(fetchTrace).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'PONG',
        origin: PERFETTO_ORIGIN,
        source: perfettoWindow,
      }),
    );

    await waitFor(() => expect(fetchTrace).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          perfetto: expect.objectContaining({
            title: 'Test run · execution trace',
            fileName: 'perfetto',
            localOnly: true,
            keepApiOpen: true,
          }),
        }),
        PERFETTO_ORIGIN,
      ),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Current-run trace loaded.');
  });
});
