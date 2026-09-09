import { describe, expect, it, vi } from 'vitest';

import { fetchTraceBuffer, resolveSameOriginTraceUrl } from './perfettoBridge';

describe('Perfetto bridge', () => {
  it('resolves only HTTP resources from the visualization origin', () => {
    expect(
      resolveSameOriginTraceUrl('/api/v1/runs/r_1/traces/perfetto', 'http://localhost:5177/ui/')
        .href,
    ).toBe('http://localhost:5177/api/v1/runs/r_1/traces/perfetto');
    expect(() =>
      resolveSameOriginTraceUrl('https://untrusted.example/run.pftrace', 'http://localhost:5177/'),
    ).toThrow('must resolve to the visualization origin');
    expect(() => resolveSameOriginTraceUrl('data:secret', 'http://localhost:5177/')).toThrow(
      'must resolve to the visualization origin',
    );
  });

  it('rejects unsuccessful trace responses before reading their body', async () => {
    const arrayBuffer = vi.fn();
    const fetchTrace = vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer });
    const controller = new AbortController();

    await expect(
      fetchTraceBuffer(
        fetchTrace,
        new URL('http://localhost:5177/api/v1/runs/r_1/traces/perfetto'),
        controller.signal,
      ),
    ).rejects.toThrow('HTTP 404');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchTrace).toHaveBeenCalledWith(expect.any(URL), {
      credentials: 'same-origin',
      signal: controller.signal,
    });
  });
});
