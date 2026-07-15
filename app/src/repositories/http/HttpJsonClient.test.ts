import { afterEach, describe, expect, it, vi } from 'vitest';

import { HttpJsonClient } from './HttpJsonClient';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function artifactBusyResponse(retryAfter: string | null = '0'): Response {
  return new Response(
    JSON.stringify({
      type: 'about:blank',
      title: 'Artifact readers are busy',
      status: 503,
      code: 'artifact_read_busy',
      detail: 'Retry shortly.',
    }),
    {
      status: 503,
      headers: {
        'Content-Type': 'application/problem+json',
        ...(retryAfter === null ? {} : { 'Retry-After': retryAfter }),
      },
    },
  );
}

interface PendingFetch {
  reject(error: unknown): void;
  resolve(response: Response): void;
}

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

  it('limits active fetches to four and starts queued reads in FIFO order', async () => {
    const started: string[] = [];
    const pending: PendingFetch[] = [];
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      started.push(String(input));
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      return new Promise<Response>((resolve, reject) => {
        pending.push({
          reject,
          resolve: (response) => {
            activeFetches -= 1;
            resolve(response);
          },
        });
      });
    });
    const client = new HttpJsonClient('/api/v1/', fetchImpl);
    const addresses = Array.from({ length: 8 }, (_, index) =>
      client.endpoint(`resources/${index}`),
    );

    const reads = addresses.map((address) => client.readJson(address));

    expect(started).toEqual(addresses.slice(0, 4).map(String));
    expect(activeFetches).toBe(4);
    pending[0]?.resolve(jsonResponse({ index: 0 }));
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(started[4]).toBe(String(addresses[4]));

    for (let index = 1; index < addresses.length; index += 1) {
      await vi.waitFor(() => expect(pending[index]).toBeDefined());
      pending[index]?.resolve(jsonResponse({ index }));
    }

    await expect(Promise.all(reads)).resolves.toEqual(addresses.map((_, index) => ({ index })));
    expect(started).toEqual(addresses.map(String));
    expect(maxActiveFetches).toBe(4);
  });

  it('honors Retry-After before retrying artifact_read_busy', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(artifactBusyResponse('1'))
      .mockResolvedValueOnce(jsonResponse({ ready: true }));
    const client = new HttpJsonClient('/api/v1/', fetchImpl);

    const read = client.readJson(client.endpoint('resource'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(read).resolves.toEqual({ ready: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('honors an HTTP-date Retry-After value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T20:00:00.000Z'));
    const retryAt = new Date(Date.now() + 1_000).toUTCString();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(artifactBusyResponse(retryAt))
      .mockResolvedValueOnce(jsonResponse({ ready: true }));
    const client = new HttpJsonClient('/api/v1/', fetchImpl);

    const read = client.readJson(client.endpoint('resource'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(read).resolves.toEqual({ ready: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('releases the slot while busy and retries from the FIFO tail', async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const pending: PendingFetch[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      started.push(String(input));
      return new Promise<Response>((resolve, reject) => {
        pending.push({ reject, resolve });
      });
    });
    const client = new HttpJsonClient('/api/v1/', fetchImpl);
    const addresses = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
      client.endpoint(`resources/${name}`),
    );
    const reads = addresses.map((address) => client.readJson(address));

    expect(started).toEqual(addresses.slice(0, 4).map(String));
    pending[0]?.resolve(artifactBusyResponse('1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(addresses.slice(0, 5).map(String));

    pending[1]?.resolve(jsonResponse({ name: 'b' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(addresses.map(String));

    await vi.advanceTimersByTimeAsync(1_000);
    expect(started).toHaveLength(6);
    pending[2]?.resolve(jsonResponse({ name: 'c' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([...addresses.map(String), String(addresses[0])]);

    pending[3]?.resolve(jsonResponse({ name: 'd' }));
    pending[4]?.resolve(jsonResponse({ name: 'e' }));
    pending[5]?.resolve(jsonResponse({ name: 'f' }));
    pending[6]?.resolve(jsonResponse({ name: 'a' }));
    await expect(Promise.all(reads)).resolves.toEqual(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => ({ name })),
    );
  });

  it('keeps the cached ETag and body when a busy retry returns 304', async () => {
    const requestHeaders: Headers[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      requestHeaders.push(new Headers(init?.headers));
      switch (requestHeaders.length) {
        case 1:
          return Promise.resolve(
            new Response(JSON.stringify({ generation: 1 }), {
              headers: {
                'Content-Type': 'application/json',
                ETag: '"resource-v1"',
              },
            }),
          );
        case 2:
          return Promise.resolve(artifactBusyResponse());
        default:
          return Promise.resolve(
            new Response(null, { status: 304, headers: { ETag: '"resource-v1"' } }),
          );
      }
    });
    const client = new HttpJsonClient('/api/v1/', fetchImpl);
    const address = client.endpoint('resource');

    const first = await client.readJson(address);
    await expect(client.readJson(address)).resolves.toEqual(first);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(requestHeaders[0]?.get('If-None-Match')).toBeNull();
    expect(requestHeaders[1]?.get('If-None-Match')).toBe('"resource-v1"');
    expect(requestHeaders[2]?.get('If-None-Match')).toBe('"resource-v1"');
  });

  it('does not retry a non-retryable service error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 503,
          code: 'artifact_read_failed',
          detail: 'The artifact read failed.',
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/problem+json',
            'Retry-After': '0',
          },
        },
      ),
    );
    const client = new HttpJsonClient('/api/v1/', fetchImpl);

    await expect(client.readJson(client.endpoint('resource'))).rejects.toMatchObject({
      code: 'artifact_read_failed',
      status: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['missing', null],
    ['invalid', 'soon'],
    ['fractional', '0.5'],
    ['negative', '-1'],
    ['fractional', '1.5'],
    ['longer than the client bound', '6'],
  ])('does not retry artifact_read_busy with a %s Retry-After', async (_case, retryAfter) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(artifactBusyResponse(retryAfter));
    const client = new HttpJsonClient('/api/v1/', fetchImpl);

    await expect(client.readJson(client.endpoint('resource'))).rejects.toMatchObject({
      code: 'artifact_read_busy',
      status: 503,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds repeated artifact_read_busy retries', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(artifactBusyResponse()));
    const client = new HttpJsonClient('/api/v1/', fetchImpl);

    const failure = client.readJson(client.endpoint('resource'));
    await expect(failure).rejects.toMatchObject({ code: 'artifact_read_busy', status: 503 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('releases a scheduler slot when fetch throws', async () => {
    const started: string[] = [];
    const pending: PendingFetch[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      started.push(String(input));
      return new Promise<Response>((resolve, reject) => {
        pending.push({ reject, resolve });
      });
    });
    const client = new HttpJsonClient('/api/v1/', fetchImpl);
    const addresses = Array.from({ length: 5 }, (_, index) =>
      client.endpoint(`resources/${index}`),
    );
    const reads = addresses.map((address) => client.readJson(address));

    expect(started).toEqual(addresses.slice(0, 4).map(String));
    pending[0]?.reject(new Error('socket reset'));
    await expect(reads[0]).rejects.toMatchObject({ code: 'network_error' });
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(started[4]).toBe(String(addresses[4]));

    for (let index = 1; index < addresses.length; index += 1) {
      pending[index]?.resolve(jsonResponse({ index }));
    }
    await expect(Promise.all(reads.slice(1))).resolves.toEqual(
      addresses.slice(1).map((_, index) => ({ index: index + 1 })),
    );
  });
});
