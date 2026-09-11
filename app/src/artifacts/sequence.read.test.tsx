import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { operationsSeqRef } from './ref';
import { fetchSequence, useSequenceWindow, type SequenceWindowRequest } from './sequence';

const RUN = { kind: 'run', id: 'run-1', workspace: 'w_main', revision: 'old' } as const;
const SEQUENCE = operationsSeqRef(RUN, [
  { at: 'pool', role: 'ffn' },
  { at: 'worker', id: '2' },
]);
const OTHER_SEQUENCE = operationsSeqRef(RUN, [
  { at: 'pool', role: 'attn' },
  { at: 'worker', id: '7' },
]);

function operation(ordinal: number) {
  return {
    ordinal,
    iter_id: String(Math.floor(ordinal / 4)),
    batch_id: '0',
    operation_id: String(ordinal),
    section: 'ffn',
    layer: ordinal % 62,
    start_ms: ordinal,
    end_ms: ordinal + 1,
  };
}

function rangeBody(offset: number, limit: number, total = 400) {
  const returned = Math.min(limit, total - offset);
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: 2 },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    total_operations: total,
    span: { start_ms: 0, end_ms: total },
    range: { offset, limit, returned },
    operations: Array.from({ length: returned }, (_, index) => operation(offset + index)),
  };
}

function seekBody(atMs: number, viewportOffset: number, total = 400) {
  const bufferOffset = Math.max(0, viewportOffset - 64);
  const returned = Math.min(192, total - bufferOffset);
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: 2 },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    at_ms: atMs,
    total_operations: total,
    span: { start_ms: 0, end_ms: total },
    hits: [operation(Math.floor(atMs))],
    anchor: { ordinal: Math.floor(atMs), kind: 'hit' },
    suggested_viewport: { offset: viewportOffset, limit: 64 },
    buffer: {
      offset: bufferOffset,
      limit: 192,
      returned,
      operations: Array.from({ length: returned }, (_, index) => operation(bufferOffset + index)),
    },
  };
}

function response(body: unknown, etag = '"current"') {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', etag },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('operation sequence reads', () => {
  it('uses the real range route and keeps the descriptor revision across per-range ETags', async () => {
    const fetch = vi.fn().mockResolvedValue(response(rangeBody(64, 64), 'W/"current"'));
    vi.stubGlobal('fetch', fetch);

    const result = await fetchSequence(SEQUENCE, { mode: 'range', offset: 64, limit: 64 });
    expect(result).toMatchObject({
      status: 'ready',
      revision: 'old',
      value: { offset: 64 },
    });
    expect(result.status === 'ready' && result.value.operations[0]?.ordinal).toBe(64);
    expect(fetch).toHaveBeenCalledWith(
      '/api/analyzer/v1/runs/run-1/workers/ffn/2/subjects/operations/payload?offset=64&limit=64&rev=old',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    );
  });

  it('maps missing routes and malformed sequence bodies to explicit states', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(
          response({ ...rangeBody(0, 64), worker: { pool_tag: 'attn', worker_id: 2 } }),
        )
        .mockResolvedValueOnce(response(rangeBody(64, 64)))
        .mockResolvedValueOnce(response(rangeBody(0, 384))),
    );
    await expect(
      fetchSequence(SEQUENCE, { mode: 'range', offset: 0, limit: 64 }),
    ).resolves.toMatchObject({
      status: 'unavailable',
      code: '404',
    });
    await expect(
      fetchSequence(SEQUENCE, { mode: 'range', offset: 0, limit: 64 }),
    ).resolves.toMatchObject({
      status: 'incompatible',
      issues: expect.arrayContaining([expect.stringContaining('worker')]),
    });
    await expect(
      fetchSequence(SEQUENCE, { mode: 'range', offset: 0, limit: 64 }),
    ).resolves.toMatchObject({
      status: 'incompatible',
      issues: expect.arrayContaining([expect.stringContaining('expected offset 0')]),
    });
    await expect(
      fetchSequence(SEQUENCE, { mode: 'range', offset: 0, limit: 192 }),
    ).resolves.toMatchObject({
      status: 'incompatible',
      issues: expect.arrayContaining([expect.stringContaining('limit 192')]),
    });
  });

  it('keeps 64 visible operations mounted while a directional refill is pending', async () => {
    const refill = deferred<Response>();
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('offset=192')
        ? refill.promise
        : Promise.resolve(response(rangeBody(0, 192)));
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useSequenceWindow(SEQUENCE, { mode: 'start' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.result.status).toBe('ready'));

    act(() => {
      result.current.shift('next');
      result.current.shift('next');
    });
    expect(result.current.result).toMatchObject({
      status: 'ready',
      value: {
        refreshing: true,
        viewport: { viewportOffset: 128, buffer: { offset: 0 } },
      },
    });
    expect(
      result.current.result.status === 'ready' &&
        result.current.result.value.operations[0]?.ordinal,
    ).toBe(128);

    act(() => refill.resolve(response(rangeBody(192, 64))));
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: { refreshing: false, viewport: { buffer: { offset: 64 } } },
      }),
    );
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      '/api/analyzer/v1/runs/run-1/workers/ffn/2/subjects/operations/payload?offset=192&limit=64&rev=old',
    );
  });

  it('rejects a mismatched refill without blanking the resident window and permits retry', async () => {
    let refillCount = 0;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes('offset=192')) return Promise.resolve(response(rangeBody(0, 192)));
      refillCount += 1;
      return Promise.resolve(response(refillCount === 1 ? rangeBody(128, 64) : rangeBody(192, 64)));
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useSequenceWindow(SEQUENCE, { mode: 'start' }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.result.status).toBe('ready'));
    act(() => {
      result.current.shift('next');
      result.current.shift('next');
    });
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: {
          viewport: { viewportOffset: 128, pending: null, buffer: { offset: 0 } },
          refreshProblem: { status: 'incompatible' },
        },
      }),
    );

    act(() => result.current.shift('next'));
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: { refreshProblem: null, viewport: { buffer: { offset: 64 } } },
      }),
    );
    expect(refillCount).toBe(2);
  });

  it('discards a late seek response whose cursor is no longer current', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('at_ms=10.5')) return first.promise;
        if (url.includes('at_ms=20.5')) return second.promise;
        return Promise.resolve(response(rangeBody(0, 192)));
      }),
    );
    const { result, rerender } = renderHook(
      ({ request }: { request: SequenceWindowRequest }) => useSequenceWindow(SEQUENCE, request),
      { initialProps: { request: { mode: 'start' } }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.result.status).toBe('ready'));

    rerender({ request: { mode: 'seek', atMs: 10.5 } });
    rerender({ request: { mode: 'seek', atMs: 20.5 } });
    act(() => second.resolve(response(seekBody(20.5, 20))));
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: { viewport: { viewportOffset: 20 }, seek: { atMs: 20.5 } },
      }),
    );

    act(() => first.resolve(response(seekBody(10.5, 10))));
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: { viewport: { viewportOffset: 20 }, seek: { atMs: 20.5 } },
      }),
    );
  });

  it('reports a failed seek without removing the last usable window', async () => {
    const nextSeek = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('at_ms=43.5')
          ? nextSeek.promise
          : String(input).includes('/seek')
            ? Promise.resolve(new Response('', { status: 500, statusText: 'Internal Error' }))
            : Promise.resolve(response(rangeBody(0, 192))),
      ),
    );
    const { result, rerender } = renderHook(
      ({ request }: { request: SequenceWindowRequest }) => useSequenceWindow(SEQUENCE, request),
      { initialProps: { request: { mode: 'start' } }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.result.status).toBe('ready'));
    rerender({ request: { mode: 'seek', atMs: 42.5 } });
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: {
          viewport: { viewportOffset: 0 },
          operations: expect.any(Array),
          refreshProblem: { status: 'failed', code: '500' },
        },
      }),
    );

    rerender({ request: { mode: 'seek', atMs: 43.5 } });
    expect(result.current.result).toMatchObject({
      status: 'ready',
      value: { refreshing: true, refreshProblem: null, viewport: { viewportOffset: 0 } },
    });
    act(() => nextSeek.resolve(response(seekBody(43.5, 43))));
    await waitFor(() =>
      expect(result.current.result).toMatchObject({
        status: 'ready',
        value: { refreshing: false, refreshProblem: null, viewport: { viewportOffset: 43 } },
      }),
    );
  });

  it('hides the old worker synchronously and never derives a new-worker refill from it', async () => {
    const oldRefill = deferred<Response>();
    const otherInitial = deferred<Response>();
    const fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/workers/ffn/2/') && url.includes('offset=192')) {
        return oldRefill.promise;
      }
      if (url.includes('/workers/attn/7/')) return otherInitial.promise;
      return Promise.resolve(response(rangeBody(0, 192)));
    });
    vi.stubGlobal('fetch', fetch);

    const { result, rerender } = renderHook(
      ({ sequence }) => useSequenceWindow(sequence, { mode: 'start' }),
      { initialProps: { sequence: SEQUENCE }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.result.status).toBe('ready'));
    act(() => {
      result.current.shift('next');
      result.current.shift('next');
    });
    await waitFor(() =>
      expect(fetch.mock.calls.some(([url]) => String(url).includes('offset=192'))).toBe(true),
    );

    rerender({ sequence: OTHER_SEQUENCE });
    expect(result.current.result).toEqual({ status: 'pending' });
    expect(
      fetch.mock.calls.some(
        ([url]) => String(url).includes('/workers/attn/7/') && String(url).includes('offset=192'),
      ),
    ).toBe(false);

    act(() => oldRefill.resolve(response(rangeBody(192, 64))));
    await act(async () => Promise.resolve());
    expect(result.current.result).toEqual({ status: 'pending' });

    const otherBody = rangeBody(0, 192);
    otherBody.worker = { pool_tag: 'attn', worker_id: 7 };
    act(() => otherInitial.resolve(response(otherBody)));
    await waitFor(() => expect(result.current.result.status).toBe('ready'));
    expect(
      result.current.result.status === 'ready' &&
        result.current.result.value.viewport.buffer.worker,
    ).toEqual({ poolTag: 'attn', workerId: '7' });
  });

  it('treats a revision change as a different sequence before effects run', async () => {
    const nextRevision = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        String(input).includes('rev=next')
          ? nextRevision.promise
          : Promise.resolve(response(rangeBody(0, 192))),
      ),
    );
    const { result, rerender } = renderHook(
      ({ sequence }) => useSequenceWindow(sequence, { mode: 'start' }),
      { initialProps: { sequence: SEQUENCE }, wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.result.status).toBe('ready'));

    const next = operationsSeqRef({ ...RUN, revision: 'next' }, SEQUENCE.at);
    rerender({ sequence: next });
    expect(result.current.result).toEqual({ status: 'pending' });

    act(() => nextRevision.resolve(response(rangeBody(0, 192), '"range-specific"')));
    await waitFor(() => expect(result.current.result.status).toBe('ready'));
    expect(result.current.result).toMatchObject({ status: 'ready', revision: 'next' });
  });
});
