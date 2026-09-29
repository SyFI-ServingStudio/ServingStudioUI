import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchArtifact } from './client';
import { catalogRef, hardwareGpuRef, operationsSeqRef, runDescriptorRef } from './ref';
import { fetchSequence } from './sequence';
import { refWorkspace, registerWorkspaceTransport, transportFor } from './transport';

const RUN = { kind: 'run', id: 'r_1', workspace: 'w_browser' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('workspace transports', () => {
  it('names the workspace every ref reads from, and none for a GPU spec', () => {
    expect(refWorkspace(catalogRef('w_browser', 'sweep'))).toBe('w_browser');
    expect(refWorkspace(runDescriptorRef(RUN))).toBe('w_browser');
    expect(refWorkspace(hardwareGpuRef('NVIDIA H200'))).toBeNull();
  });

  it('answers a registered workspace with its transport and every other with the server', async () => {
    const server = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', server);
    const browser = vi.fn(
      async () =>
        new Response(JSON.stringify({ protocol_version: 1, generated_at: 'x', sweeps: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const unregister = registerWorkspaceTransport('w_browser', browser);
    try {
      const result = await fetchArtifact(catalogRef('w_browser', 'sweep'));
      expect(result.status).toBe('ready');
      expect(browser).toHaveBeenCalledWith('/api/analyzer/v1/sweeps', { signal: undefined });
      expect(server).not.toHaveBeenCalled();

      await fetchArtifact(catalogRef('w_main', 'sweep'));
      expect(server).toHaveBeenCalledWith('/api/analyzer/v1/sweeps', {
        signal: undefined,
        headers: { accept: 'application/json' },
      });
    } finally {
      unregister();
    }
    expect(transportFor(catalogRef('w_browser', 'sweep'))).not.toBe(browser);
  });

  it('routes a sequence read by its result workspace', async () => {
    const browser = vi.fn(async () => new Response('not json', { status: 200 }));
    const unregister = registerWorkspaceTransport('w_browser', browser);
    try {
      const ref = operationsSeqRef(RUN, [
        { at: 'pool', role: 'main' },
        { at: 'worker', id: '0' },
      ]);
      const result = await fetchSequence(ref, { mode: 'range', offset: 0, limit: 10 });
      expect(browser).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ status: 'failed', code: 'invalid_json' });
    } finally {
      unregister();
    }
  });

  it('keeps a newer registration when an older one is released', () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = registerWorkspaceTransport('w_x', first);
    registerWorkspaceTransport('w_x', second)();
    registerWorkspaceTransport('w_x', second);
    releaseFirst();
    expect(transportFor(catalogRef('w_x', 'run'))).toBe(second);
  });
});
