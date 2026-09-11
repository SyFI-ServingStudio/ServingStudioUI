import { describe, expect, it } from 'vitest';

import { EMPTY_FOCUS, type Focus } from '../location';
import { descendTo } from './descend';

function focus(over: Partial<Focus> = {}): Focus {
  return { ...EMPTY_FOCUS, ...over };
}

describe('descendTo', () => {
  it('lets go of a pinned panel', () => {
    // Without this the address changes, the pinned panel still applies at the
    // new depth, and the reader clicks a row that visibly does nothing — while
    // the panel that is about the depth they opened stays hidden behind the pin.
    const opened = descendTo(focus({ panel: 'run.kernel-time' }), { at: 'pool', role: 'decode' });
    expect(opened.panel).toBeNull();
    expect(opened.path).toEqual([{ at: 'pool', role: 'decode' }]);
  });

  it('writes a worker with the pool that owns it', () => {
    const opened = descendTo(focus(), { at: 'pool', role: 'decode' }, { at: 'worker', id: '1' });
    expect(opened.path).toEqual([
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '1' },
    ]);
  });

  it('drops what the new coordinate invalidates', () => {
    // Worker 3 of prefill is not worker 3 of decode, so selecting the other
    // pool cannot leave it hanging underneath.
    const inside = focus({
      path: [
        { at: 'pool', role: 'prefill' },
        { at: 'worker', id: '3' },
      ],
    });
    expect(descendTo(inside, { at: 'pool', role: 'decode' }).path).toEqual([
      { at: 'pool', role: 'decode' },
    ]);
  });

  it('keeps everything else about where the reader is', () => {
    // The option is the reader's choice about how to read a breakdown, and it
    // means the same thing one level down. The cursor is where they are in time.
    const opened = descendTo(focus({ options: { queue: 'peak' }, cursorMs: 1200 }), {
      at: 'pool',
      role: 'decode',
    });
    expect(opened.options).toEqual({ queue: 'peak' });
    expect(opened.cursorMs).toBe(1200);
  });
});
