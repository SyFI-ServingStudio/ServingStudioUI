import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { formatLocation } from './format';
import { defaultWorkspace, navigate, useLocation } from './navigate';
import { EMPTY_FOCUS, type Location } from './types';

function resultAt(id: string): Location {
  return {
    view: 'result',
    ref: { kind: 'run', id, workspace: 'w_main' },
    focus: EMPTY_FOCUS,
    chat: null,
  };
}

/**
 * `history.back()` and `forward()` are asynchronous in a browser as well as in
 * jsdom — the entry changes, then `popstate` fires. Waiting for the event is the
 * only way to assert what the hook shows afterwards.
 */
async function travel(move: () => void): Promise<void> {
  await act(async () => {
    const popped = new Promise<void>((resolve) => {
      window.addEventListener('popstate', () => resolve(), { once: true });
    });
    move();
    await popped;
  });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('the browser boundary', () => {
  it('commits a Location to the address bar and tells subscribers', () => {
    const { result } = renderHook(() => useLocation());
    act(() => navigate(resultAt('r1'), 'push'));

    // `pushState` fires no `hashchange`, so this only works because `navigate`
    // notifies its own subscribers.
    expect(window.location.hash).toBe(formatLocation(resultAt('r1')));
    expect(result.current).toEqual(resultAt('r1'));
  });

  it('keeps back and forward in step with the rendered Location', async () => {
    const { result } = renderHook(() => useLocation());
    act(() => navigate(resultAt('r1'), 'push'));
    act(() => navigate(resultAt('r2'), 'push'));
    expect(result.current).toEqual(resultAt('r2'));

    await travel(() => window.history.back());
    expect(result.current).toEqual(resultAt('r1'));

    await travel(() => window.history.forward());
    expect(result.current).toEqual(resultAt('r2'));
  });

  it('does not stack a history entry for the address already shown', () => {
    renderHook(() => useLocation());
    act(() => navigate(resultAt('r1'), 'push'));
    const depth = window.history.length;
    act(() => navigate(resultAt('r1'), 'push'));
    expect(window.history.length).toBe(depth);
  });

  it('replaces without leaving the previous address behind', async () => {
    const { result } = renderHook(() => useLocation());
    act(() => navigate(resultAt('r1'), 'push'));
    act(() => navigate(resultAt('r2'), 'replace'));
    expect(result.current).toEqual(resultAt('r2'));

    // r1's entry was overwritten, so back leaves the result view entirely for the
    // entry address instead of returning to r1.
    await travel(() => window.history.back());
    expect(result.current).toEqual({
      view: 'catalog',
      filter: { workspace: 'w_main', kinds: [], query: null },
    });
  });

  it('reports an unaddressable hash as null rather than guessing', () => {
    const { result } = renderHook(() => useLocation());
    act(() => window.history.pushState(null, '', '#/no-such-view'));
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(result.current).toBeNull();
  });

  it('takes the deployment workspace pin from the document query, not the hash', () => {
    expect(defaultWorkspace()).toBe('w_main');
    window.history.replaceState(null, '', '/?workspace=w_pinned');
    expect(defaultWorkspace()).toBe('w_pinned');
    // A value the backend could never issue must not become the ambient default.
    window.history.replaceState(null, '', '/?workspace=nonsense');
    expect(defaultWorkspace()).toBe('w_main');
  });
});
