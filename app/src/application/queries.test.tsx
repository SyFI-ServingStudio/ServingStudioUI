import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunDescriptor } from '../domain/artifacts';
import { parseAnalyzerV1ModelResource } from '../contracts/analyzer/v1/overviewResources';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { createTestRepository, makeTestDescriptor } from '../test/analyzerRepositoryFixture';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';
import {
  analyzerQueryKeys,
  useDescriptorModelQuery,
  useDescriptorSubjectQuery,
  useDescriptorWorkloadQuery,
  useRunDescriptorQuery,
  useRunListQuery,
  workerOperationsQueryOptions,
} from './queries';

const queryClients = new Set<QueryClient>();

async function flushImmediateQueryWork() {
  await act(async () => {
    // React Query resolves the repository promise, applies structural sharing,
    // then schedules observer notification. Drain only zero-delay work so the
    // lifecycle interval under test is never advanced accidentally.
    for (let turn = 0; turn < 4; turn += 1) {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

function queryWrapper(repository: AnalyzerRepository) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  queryClients.add(queryClient);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AnalyzerRepositoryProvider repository={repository}>{children}</AnalyzerRepositoryProvider>
      </QueryClientProvider>
    );
  }
  return { queryClient, Wrapper };
}

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  for (const queryClient of queryClients) queryClient.clear();
  queryClients.clear();
});

describe('run lifecycle queries', () => {
  it('polls a pending descriptor at 2 seconds, then stops after completion', async () => {
    vi.useFakeTimers();
    const pending = makeTestDescriptor({
      lifecycle: { simulation: 'complete', analysis: 'pending' },
      analysis: undefined,
    });
    const complete = makeTestDescriptor();
    const { repository } = createTestRepository();
    const getRunDescriptor = vi
      .spyOn(repository, 'getRunDescriptor')
      .mockResolvedValueOnce(pending)
      .mockResolvedValue(complete);
    const { queryClient, Wrapper } = queryWrapper(repository);

    const { result } = renderHook(() => useRunDescriptorQuery('test-run'), {
      wrapper: Wrapper,
    });
    await flushImmediateQueryWork();
    expect(result.current.data?.lifecycle.analysis).toBe('pending');
    expect(getRunDescriptor).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await flushImmediateQueryWork();
    expect(getRunDescriptor).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<RunDescriptor>(analyzerQueryKeys.descriptor('test-run'))?.lifecycle
        .analysis,
    ).toBe('complete');

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getRunDescriptor).toHaveBeenCalledTimes(2);
  });

  it('uses a 30-second catalog cadence and refreshes both queries on focus', async () => {
    vi.useFakeTimers();
    const { repository } = createTestRepository();
    const listRuns = vi.spyOn(repository, 'listRuns');
    const getRunDescriptor = vi.spyOn(repository, 'getRunDescriptor');
    const { Wrapper } = queryWrapper(repository);

    const { result } = renderHook(
      () => ({ catalog: useRunListQuery(), descriptor: useRunDescriptorQuery('test-run') }),
      { wrapper: Wrapper },
    );
    await flushImmediateQueryWork();
    expect(result.current.catalog.data).toHaveLength(1);
    expect(result.current.descriptor.data?.lifecycle.analysis).toBe('complete');
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRunDescriptor).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(29_999));
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRunDescriptor).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(getRunDescriptor).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await Promise.resolve();
    });
    await flushImmediateQueryWork();
    expect(listRuns).toHaveBeenCalledTimes(3);
    expect(getRunDescriptor).toHaveBeenCalledTimes(2);
  });
});

describe('overview resource queries', () => {
  it('keeps undeclared resources not-generated without repository I/O', () => {
    const descriptor = makeTestDescriptor();
    const { repository, calls } = createTestRepository({ descriptor });
    const { Wrapper } = queryWrapper(repository);

    const { result } = renderHook(
      () => ({
        model: useDescriptorModelQuery(descriptor),
        workload: useDescriptorWorkloadQuery(descriptor),
      }),
      { wrapper: Wrapper },
    );

    expect(result.current.model.status).toBe('not_generated');
    expect(result.current.workload.status).toBe('not_generated');
    expect(calls.model).toBe(0);
    expect(calls.workload).toBe(0);
  });

  it('loads model and workload into separate href/schema-scoped entries', async () => {
    const descriptor = makeTestDescriptor({
      model: { href: 'model', schemaVersion: 2 },
      workload: { href: 'workload', schemaVersion: 1 },
    });
    const model = {
      schemaVersion: 2 as const,
      sourcePath: 'model/config/test.json',
      config: { hidden_size: 6144 },
      parameterCounts: {
        total: 8_030_261_248,
        active: 8_030_261_248,
        activeLayers: 6_979_588_096,
        activeDefinition: 'with_embed_head' as const,
      },
    };
    const workload = {
      schemaVersion: 1 as const,
      scope: 'configured_trace' as const,
      sourcePaths: ['trace/test.csv'],
      requestCount: 1,
      averageInputTokens: 16,
      averageOutputTokens: 32,
      arrivalBasis: 'source_trace' as const,
      requestRate: 0,
      tokenLengths: [16],
      inputDensity: [1],
      outputDensity: [1],
      arrivalSeconds: [0],
      arrivals: [1],
      arrivalTrend: [1],
      peakToMean: 1,
    };
    const { repository, calls } = createTestRepository({ descriptor, model, workload });
    const { queryClient, Wrapper } = queryWrapper(repository);

    const { result } = renderHook(
      () => ({
        model: useDescriptorModelQuery(descriptor),
        workload: useDescriptorWorkloadQuery(descriptor),
      }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.model.status).toBe('ready');
      expect(result.current.workload.status).toBe('ready');
    });
    expect(calls.model).toBe(1);
    expect(calls.workload).toBe(1);
    expect(
      queryClient.getQueryData(analyzerQueryKeys.overviewResource('test-run', 'model', 'model', 2)),
    ).toEqual(model);
    expect(
      queryClient.getQueryData(
        analyzerQueryKeys.overviewResource('test-run', 'workload', 'workload', 1),
      ),
    ).toEqual(workload);
  });

  it('reports a malformed declared overview resource as incompatible', async () => {
    const descriptor = makeTestDescriptor({
      model: { href: 'model', schemaVersion: 1 },
    });
    const { repository } = createTestRepository({ descriptor });
    vi.spyOn(repository, 'getRunModel').mockImplementation(async () =>
      parseAnalyzerV1ModelResource({
        schema_version: 1,
        source_path: '../outside.json',
        config: {},
      }),
    );
    const { Wrapper } = queryWrapper(repository);

    const { result } = renderHook(() => useDescriptorModelQuery(descriptor), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('incompatible'));
    expect(result.current).toMatchObject({
      status: 'incompatible',
      reason: expect.stringContaining('Invalid analyzer-v1 model resource'),
    });
  });
});

describe('subject queries', () => {
  it('does not perform I/O for a descriptor-declared non-ready subject', () => {
    const descriptor = makeTestDescriptor();
    descriptor.subjects.slo = {
      status: 'unavailable',
      code: 'missing_request_events',
      reason: 'Request lifecycle events were not logged.',
    };
    const { repository, calls } = createTestRepository({ descriptor });
    const { Wrapper } = queryWrapper(repository);

    const { result } = renderHook(() => useDescriptorSubjectQuery(descriptor, 'slo'), {
      wrapper: Wrapper,
    });

    expect(result.current).toEqual({ subject: 'slo', ...descriptor.subjects.slo });
    expect(calls.subjects).toBe(0);
  });

  it('loads one ready subject into its revision/schema-scoped cache entry', async () => {
    const descriptor = makeTestDescriptor();
    const { repository, calls } = createTestRepository({ descriptor });
    const { queryClient, Wrapper } = queryWrapper(repository);

    const { result } = renderHook(() => useDescriptorSubjectQuery(descriptor, 'slo'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(calls.subjects).toBe(1);
    expect(
      queryClient.getQueryData(analyzerQueryKeys.subject('test-run', 'slo', 1, 'test-revision-v1')),
    ).toEqual(result.current);
    expect(analyzerQueryKeys.subject('test-run', 'slo', 1, 'revision-a')).not.toEqual(
      analyzerQueryKeys.subject('test-run', 'slo', 1, 'revision-b'),
    );
  });
});

describe('worker operation range queries', () => {
  it('shares one fresh cache entry between prefetch and the visible page', async () => {
    const { repository, calls } = createTestRepository();
    const { queryClient } = queryWrapper(repository);
    const worker = { poolTag: 'ffn', workerId: '2' };
    const options = workerOperationsQueryOptions(
      repository,
      'test-run',
      worker,
      50,
      50,
      1,
      'test-revision-v1',
    );

    await queryClient.prefetchQuery(options);
    const page = await queryClient.fetchQuery(options);

    expect(calls.operations).toBe(1);
    expect(page.worker).toEqual(worker);
    expect(queryClient.getQueryData(options.queryKey)).toEqual(page);
  });
});
