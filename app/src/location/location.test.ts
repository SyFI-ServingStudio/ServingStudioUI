import { describe, expect, it } from 'vitest';

import { selectSegment, upTo, withCursor, withOption } from './focus';
import { formatLocation, sameLocation } from './format';
import { parseLocation } from './parse';
import { EMPTY_FOCUS, locationSchema, type Focus, type Location, type Segment } from './types';

const defaults = { workspace: 'w_main' } as const;

function parse(hash: string): Location | null {
  return parseLocation(hash, defaults);
}

describe('canonical addresses', () => {
  it('writes the documented form for each view', () => {
    expect(
      formatLocation({
        view: 'catalog',
        filter: { workspace: 'w_main', kinds: [], query: null },
      }),
    ).toBe('#/results?w=w_main');

    expect(
      formatLocation({
        view: 'result',
        ref: { kind: 'run', id: '20260907_0', workspace: 'w_main' },
        focus: {
          path: [
            { at: 'pool', role: 'decode' },
            { at: 'worker', id: '3' },
          ],
          cursorMs: 1840.5,
          panel: 'worker.kernel-time-share',
          options: { stat: 'p99' },
        },
        chat: { state: 'created', workspace: 'w_main', id: '8f5b0659dfd0' },
      }),
    ).toBe(
      '#/result/run/20260907_0?w=w_main&at=pool:decode.worker:3&t=1840.5' +
        '&panel=worker.kernel-time-share&o.stat=p99&chat=8f5b0659dfd0',
    );

    expect(formatLocation({ view: 'chat', chat: { state: 'draft', workspace: 'w_main' } })).toBe(
      '#/chat/new?w=w_main',
    );

    expect(
      formatLocation({
        view: 'file',
        file: { workspace: 'w_main', path: 'logs/20260907_0/params.yaml', line: 12 },
      }),
    ).toBe('#/file?w=w_main&path=logs/20260907_0/params.yaml&line=12');
  });

  it('omits every default, so a shared link carries only what was chosen', () => {
    const hash = formatLocation({
      view: 'result',
      ref: { kind: 'sweep', id: 's_rate', workspace: 'w_main' },
      focus: EMPTY_FOCUS,
      chat: null,
    });
    expect(hash).toBe('#/result/sweep/s_rate?w=w_main');
  });

  it('sorts options so two equal focuses share one URL and one cache key', () => {
    const focus = (options: Record<string, string>): Focus => ({ ...EMPTY_FOCUS, options });
    const left = formatLocation({
      view: 'result',
      ref: { kind: 'sweep', id: 's_rate', workspace: 'w_main' },
      focus: focus({ stat: 'p99', metric: 'tps' }),
      chat: null,
    });
    const right = formatLocation({
      view: 'result',
      ref: { kind: 'sweep', id: 's_rate', workspace: 'w_main' },
      focus: focus({ metric: 'tps', stat: 'p99' }),
      chat: null,
    });
    expect(left).toBe(right);
    expect(left).toContain('&o.metric=tps&o.stat=p99');
  });
});

/**
 * The round trip is the contract the whole design rests on: the URL is the
 * Location's serialization, so anything expressible must survive being written
 * and read back. The cases below cover every view, every segment kind, both chat
 * states, and tokens that collide with the grammar's own delimiters.
 */
describe('parse and format are inverses', () => {
  const nastyTokens = ['plain', 'a.b', 'a~b', 'a:b', '100%', 'with space', 'ünïcode', 'a&b=c#d+e'];

  const paths: Segment[][] = [
    [],
    [{ at: 'pool', role: 'decode' }],
    [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
    ],
    [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
      { at: 'operation', iter: '12', batch: '4', op: '7' },
      { at: 'leaf', id: 31 },
    ],
    [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
      { at: 'parallel', id: 0 },
    ],
    [
      { at: 'case', id: 'c1' },
      { at: 'caseOperation', id: '9' },
    ],
    [{ at: 'iteration', id: 7 }],
    [{ at: 'run', id: '20260907_0' }],
    [{ at: 'run', coordinates: { tp: 4, dtype: 'fp8', hosts: [1, 2] } }],
    ...nastyTokens.map((token): Segment[] => [{ at: 'pool', role: token }]),
  ];

  const locations: Location[] = [
    { view: 'catalog', filter: { workspace: 'w_main', kinds: [], query: null } },
    {
      view: 'catalog',
      filter: { workspace: 'w_other-1', kinds: ['run', 'prediction'], query: 'llama & 8b' },
    },
    {
      view: 'catalog',
      filter: {
        workspace: 'w_main',
        kinds: ['prediction'],
        query: 'llama',
        workspaces: ['w main', 'w,managed'],
        deployments: ['pd', 'tp=4'],
        traces: ['trace,a.csv'],
        axes: ['server_split'],
      },
    },
    { view: 'chat', chat: { state: 'draft', workspace: 'w_main' } },
    ...nastyTokens.map((token): Location => ({
      view: 'chat',
      chat: { state: 'created', workspace: 'w_main', id: token },
    })),
    ...nastyTokens.map((token): Location => ({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: EMPTY_FOCUS,
      chat: { state: 'created', workspace: 'w_main', id: token },
    })),
    ...nastyTokens.map((token): Location => ({
      view: 'file',
      file: { workspace: 'w_main', path: `logs/${token}/params.yaml`, line: null },
    })),
    { view: 'file', file: { workspace: 'w_main', path: 'a/b.txt', line: 4096 } },
    ...paths.map((path): Location => ({
      view: 'result',
      ref: { kind: 'run', id: '20260907_0', workspace: 'w_main' },
      focus: { ...EMPTY_FOCUS, path },
      chat: null,
    })),
    ...nastyTokens.map((token): Location => ({
      view: 'result',
      ref: { kind: 'run', id: token, workspace: 'w_main', revision: 'rev-7' },
      focus: { ...EMPTY_FOCUS, panel: 'kernel.throughput', options: { plot: token } },
      chat: { state: 'draft', workspace: 'w_main' },
    })),
    {
      view: 'result',
      ref: { kind: 'alignment', id: 'al_tp4', workspace: 'w_main' },
      focus: { path: [{ at: 'iteration', id: 3 }], cursorMs: 0, panel: null, options: {} },
      chat: null,
    },
  ];

  it.each(locations.map((location) => [formatLocation(location), location] as const))(
    'round-trips %s',
    (_hash, location) => {
      expect(parse(formatLocation(location))).toEqual(location);
    },
  );

  it('is idempotent, so a normalizing replace settles instead of oscillating', () => {
    for (const location of locations) {
      const once = formatLocation(location);
      const parsed = parse(once);
      expect(parsed).not.toBeNull();
      expect(formatLocation(parsed as Location)).toBe(once);
    }
  });

  it('is idempotent for a filter assembled in click order, not canonical order', () => {
    const clicked: Location = {
      view: 'catalog',
      filter: { workspace: 'w_main', kinds: ['prediction', 'run', 'run'], query: null },
    };
    const once = formatLocation(clicked);
    expect(once).toBe('#/results?w=w_main&kind=run,prediction');
    expect(formatLocation(parse(once) as Location)).toBe(once);
  });

  it('keeps every catalog column selection in the shareable address', () => {
    const location: Location = {
      view: 'catalog',
      filter: {
        workspace: 'w_main',
        kinds: ['prediction'],
        query: null,
        workspaces: ['w main', 'w,managed'],
        deployments: ['tp=4'],
        traces: ['trace,a.csv'],
        axes: ['server_split'],
      },
    };
    const href = formatLocation(location);
    expect(href).toContain('&workspace=w%20main,w%2Cmanaged');
    expect(href).toContain('&deployment=tp%3D4');
    expect(href).toContain('&trace=trace%2Ca.csv');
    expect(href).toContain('&axis=server_split');
    expect(parse(href)).toEqual(location);
  });

  it('refuses a conversation id that would read back as a draft', () => {
    // `#/chat/new` is the draft address; a created chat whose id is `new` would
    // format to exactly that and parse back as unsaved.
    expect(
      locationSchema.safeParse({
        view: 'chat',
        chat: { state: 'created', workspace: 'w_main', id: 'new' },
      }).success,
    ).toBe(false);
  });

  it('rejects a value that cannot be escaped, so formatting cannot throw', () => {
    // `encodeURIComponent` throws on a lone surrogate. Admitting one would mean
    // a schema-valid Location whose URL cannot be written.
    expect(
      locationSchema.safeParse({
        view: 'result',
        ref: { kind: 'run', id: '\uD800', workspace: 'w_main' },
        focus: EMPTY_FOCUS,
        chat: null,
      }).success,
    ).toBe(false);
  });
});

describe('parsing hand-written and stale links', () => {
  it('treats the entry hash as the catalog', () => {
    const entry = { view: 'catalog', filter: { workspace: 'w_main', kinds: [], query: null } };
    expect(parse('')).toEqual(entry);
    expect(parse('#')).toEqual(entry);
    expect(parse('#/')).toEqual(entry);
    expect(parse('#/results')).toEqual(entry);
  });

  it('falls back to the ambient workspace when the link carries none', () => {
    expect(parse('#/result/run/r1')).toEqual({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: EMPTY_FOCUS,
      chat: null,
    });
  });

  it('ignores unknown parameters so an older build opens a newer link', () => {
    expect(parse('#/result/run/r1?w=w_main&future=1')).toEqual({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: EMPTY_FOCUS,
      chat: null,
    });
  });

  it('keeps unknown option keys so a future panel option survives a round trip', () => {
    const parsed = parse('#/result/run/r1?w=w_main&o.unknown-key=x');
    expect(parsed).toEqual({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: { ...EMPTY_FOCUS, options: { 'unknown-key': 'x' } },
      chat: null,
    });
  });

  it('reports a broken link as unaddressable rather than silently landing home', () => {
    expect(parse('#/nope')).toBeNull();
    expect(parse('#/result/run')).toBeNull();
    expect(parse('#/result/no-such-kind/r1')).toBeNull();
    expect(parse('#/result/run/r1?w=not-a-workspace')).toBeNull();
    expect(parse('#/result/run/r1?w=w_main&at=worker:3')).toBeNull();
    expect(parse('#/result/run/r1?w=w_main&t=01')).toBeNull();
    expect(parse('#/result/run/r1?w=w_main&t=-5')).toBeNull();
    expect(parse('#/result/run/r1?w=w_main&o.BadKey=x')).toBeNull();
    expect(parse('#/result/run/r1?w=w_main&panel=%zz')).toBeNull();
    expect(parse('#/result/kernel-profile/kp_one?w=w_main&rev=old')).toBeNull();
    expect(parse('#/result/kernel-measurement/km_one?w=w_main&rev=old')).toBeNull();
    expect(parse('#/file?w=w_main')).toBeNull();
    expect(parse('#/file?w=w_main&path=../../etc/passwd')).toBeNull();
    expect(parse('#/chat')).toBeNull();
  });

  it('reads a draft chat from the reserved id, which no backend can mint', () => {
    expect(parse('#/chat/new')).toEqual({
      view: 'chat',
      chat: { state: 'draft', workspace: 'w_main' },
    });
  });

  it('normalizes a docked chat onto the result workspace', () => {
    // Both refs carry a workspace so each can travel alone, but a Location has
    // one; the result's is authoritative.
    const divergent: Location = {
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: EMPTY_FOCUS,
      chat: { state: 'created', workspace: 'w_elsewhere', id: 'c1' },
    };
    expect(parse(formatLocation(divergent))).toEqual({
      ...divergent,
      chat: { state: 'created', workspace: 'w_main', id: 'c1' },
    });
  });
});

describe('focus transformations', () => {
  const deep: Focus = {
    ...EMPTY_FOCUS,
    path: [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
      { at: 'operation', iter: '12', batch: '4', op: '7' },
    ],
  };

  it('drops the coordinates a new one invalidates', () => {
    // The old worker belonged to the old pool: selecting another pool cannot
    // leave it behind.
    expect(selectSegment(deep, { at: 'pool', role: 'prefill' }).path).toEqual([
      { at: 'pool', role: 'prefill' },
    ]);
    expect(selectSegment(deep, { at: 'worker', id: '9' }).path).toEqual([
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '9' },
    ]);
  });

  it('appends when the new coordinate refines the current one', () => {
    expect(selectSegment(deep, { at: 'leaf', id: 5 }).path).toEqual([
      ...deep.path,
      { at: 'leaf', id: 5 },
    ]);
  });

  it('walks back up to a named level', () => {
    expect(upTo(deep, 'pool').path).toEqual([{ at: 'pool', role: 'decode' }]);
    expect(upTo(deep, 'leaf').path).toEqual([]);
  });

  it('carries the cursor, panel and options across a path change', () => {
    // These fields are preserved on purpose; deciding whether they still apply
    // needs the panel registry and belongs to the commit point in `app/`.
    const rich: Focus = {
      ...deep,
      cursorMs: 12.5,
      panel: 'worker.batch',
      options: { stat: 'p99' },
    };
    const moved = selectSegment(rich, { at: 'pool', role: 'prefill' });
    expect(moved.cursorMs).toBe(12.5);
    expect(moved.panel).toBe('worker.batch');
    expect(moved.options).toEqual({ stat: 'p99' });
  });

  it('never mutates the focus it is given', () => {
    const before: Focus = { ...deep, options: { stat: 'p99' } };
    const snapshot = structuredClone(before);
    selectSegment(before, { at: 'pool', role: 'prefill' });
    upTo(before, 'pool');
    withOption(before, 'stat', null);
    withCursor(before, 99);
    expect(before).toEqual(snapshot);
  });

  it('removes an option when it returns to its default', () => {
    const withStat = withOption(EMPTY_FOCUS, 'stat', 'p99');
    expect(withStat.options).toEqual({ stat: 'p99' });
    expect(withOption(withStat, 'stat', null).options).toEqual({});
  });
});

describe('sameLocation', () => {
  it('compares what is addressed, not object shape', () => {
    const base: Location = {
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: { ...EMPTY_FOCUS, options: { a: '1', b: '2' } },
      chat: null,
    };
    const reordered: Location = {
      ...base,
      focus: { ...EMPTY_FOCUS, options: { b: '2', a: '1' } },
    };
    expect(sameLocation(base, reordered)).toBe(true);
    expect(sameLocation(base, { ...base, focus: EMPTY_FOCUS })).toBe(false);
  });
});
