import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunDescriptor } from '../domain/artifacts';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import { createTestRepository, makeTestDescriptor } from '../test/analyzerRepositoryFixture';
import { AnalyzerRepositoryProvider } from './RepositoryProvider';
import { analyzerQueryKeys, useRunDescriptorQuery, useRunListQuery } from './queries';

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
