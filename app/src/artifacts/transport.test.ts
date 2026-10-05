import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchArtifact } from './client';
import { catalogRef, hardwareGpuRef, operationsSeqRef } from './ref';
import { fetchSequence } from './sequence';
import { activeTransport, setFallbackTransport } from './transport';

const RUN = { kind: 'run', id: 'r_1', workspace: 'w_main' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transports', () => {
  it('reads from the server until a fallback is set, then from the fallback', async () => {
    const server = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', server);
    const embedded = vi.fn(
      async () =>
        new Response(JSON.stringify({ protocol_version: 1, generated_at: 'x', sweeps: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );

    await fetchArtifact(catalogRef('w_main', 'sweep'));
    expect(server).toHaveBeenCalledWith('/api/analyzer/v1/sweeps', {
      signal: undefined,
      headers: { accept: 'application/json' },
    });

    const release = setFallbackTransport(embedded);
    try {
      const result = await fetchArtifact(catalogRef('w_main', 'sweep'));
      expect(result.status).toBe('ready');
      expect(embedded).toHaveBeenCalledWith('/api/analyzer/v1/sweeps', { signal: undefined });
      expect(server).toHaveBeenCalledOnce();
    } finally {
      release();
    }
    expect(activeTransport()).not.toBe(embedded);
  });

  it('answers a sequence read and a GPU spec with the fallback too', async () => {
    const embedded = vi.fn(async () => new Response('not json', { status: 200 }));
    const release = setFallbackTransport(embedded);
    try {
      const ref = operationsSeqRef(RUN, [
        { at: 'pool', role: 'main' },
        { at: 'worker', id: '0' },
      ]);
      const result = await fetchSequence(ref, { mode: 'range', offset: 0, limit: 10 });
      expect(result).toMatchObject({ status: 'failed', code: 'invalid_json' });
      await fetchArtifact(hardwareGpuRef('NVIDIA H200'));
      expect(embedded).toHaveBeenCalledTimes(2);
    } finally {
      release();
    }
  });

  it('keeps a newer fallback when an older one is released', () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = setFallbackTransport(first);
    const releaseSecond = setFallbackTransport(second);
    releaseFirst();
    expect(activeTransport()).toBe(second);
    releaseSecond();
  });
});
