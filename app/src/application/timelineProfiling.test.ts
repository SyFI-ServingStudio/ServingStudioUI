import { afterEach, describe, expect, it, vi } from 'vitest';

import { beginTimelineInteraction } from './timelineProfiling';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Timeline profiling transport', () => {
  it('flushes one stable trace envelope only after the interaction delay', async () => {
    vi.useFakeTimers();
    const response = Promise.resolve(new Response(null, { status: 204 }));
    const fetch = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
      () => response,
    );
    vi.stubGlobal('fetch', fetch);

    const interactionId = beginTimelineInteraction('pointer');

    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledOnce();
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe('/api/v1/profile/timeline');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      session_id: interactionId,
      event: 'interaction-trace',
      elapsed_ms: expect.any(Number),
    });
    expect(JSON.parse(JSON.parse(String(init?.body)).detail)).toEqual([[0, 'interaction-start']]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
