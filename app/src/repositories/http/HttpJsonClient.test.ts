import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpJsonClient } from './HttpJsonClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpJsonClient', () => {
  it('binds the browser fetch receiver when no transport is injected', async () => {
    const receivers: unknown[] = [];
    const browserFetch = vi.fn(function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(
        new Response(JSON.stringify({ protocol_version: 1, runs: [] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', browserFetch);

    const client = new HttpJsonClient('/api/v1/');
    await expect(client.readJson(client.endpoint('runs'))).resolves.toMatchObject({
      protocol_version: 1,
    });

    expect(receivers).toEqual([globalThis]);
  });
});
