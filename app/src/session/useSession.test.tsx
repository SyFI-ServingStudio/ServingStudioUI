/**
 * The hook is four lines, and all four are about lifetime.
 *
 * A controller test can prove that `observe()` counts; it cannot prove that the
 * hook calls it, or that two components showing one conversation share a single
 * connection. Those are the properties that break when the hook is "simplified"
 * into owning the controller, so they are tested through React.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetSessionControllers, sessionController } from './controller';
import type { SessionRef } from './types';
import { useSession } from './useSession';

const REF: SessionRef = { workspace: 'w_main', conversation: 'c1' };

let opened: number;
/** The signals of the stream connections, newest last. */
let sockets: AbortSignal[];

function Viewer({ label, enabled = true }: { label: string; enabled?: boolean }) {
  const { state } = useSession(REF, enabled);
  return <span data-testid={label}>{state.status}</span>;
}

beforeEach(() => {
  opened = 0;
  sockets = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/stream')) {
      opened += 1;
      if (init?.signal != null) sockets.push(init.signal);
      // A turn is running, and the body never ends: the point is the socket,
      // not what comes over it.
      return Promise.resolve(new Response(new ReadableStream(), { status: 200 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ id: 'c1', messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
});

afterEach(() => {
  resetSessionControllers();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('useSession', () => {
  it('two views of one conversation share one connection', async () => {
    const view = render(
      <>
        <Viewer label="dock" />
        <Viewer label="page" />
      </>,
    );
    await settle();
    expect(opened).toBe(1);
    expect(screen.getByTestId('dock')).toHaveTextContent('streaming');
    expect(screen.getByTestId('page')).toHaveTextContent('streaming');
    view.unmount();
  });

  it('keeps the session alive while one view remains, and lets go at the last', async () => {
    // Closing one panel must not silence a second one showing the same
    // conversation; closing the last must not leave a socket open.
    const both = render(
      <>
        <Viewer label="dock" />
        <Viewer label="page" />
      </>,
    );
    await settle();
    both.rerender(<Viewer label="dock" />);
    await settle();
    expect(sessionController(REF).getState().status).toBe('streaming');

    // Not just the status: the status is what the controller *says*, and the
    // property under test is what it *did*. A controller that announced
    // `detached` while leaving the socket open would pass on the status alone,
    // and the leak would only show as an exhausted connection budget on a page
    // that had been open for a while.
    expect(sockets).toHaveLength(1);
    expect(sockets[0].aborted).toBe(false);

    both.unmount();
    await settle();
    expect(sessionController(REF).getState().status).toBe('detached');
    expect(sockets[0].aborted).toBe(true);
  });

  it('reattaches when a view comes back to a session that was let go', async () => {
    const first = render(<Viewer label="dock" />);
    await settle();
    first.unmount();
    await settle();
    const again = render(<Viewer label="dock" />);
    await settle();
    expect(opened).toBe(2);
    expect(screen.getByTestId('dock')).toHaveTextContent('streaming');
    again.unmount();
  });

  it('keeps the mounted view state while folding releases and reopening replays', async () => {
    const view = render(<Viewer label="dock" />);
    await settle();
    const node = screen.getByTestId('dock');

    view.rerender(<Viewer label="dock" enabled={false} />);
    await settle();
    expect(screen.getByTestId('dock').isSameNode(node)).toBe(true);
    expect(sockets[0]?.aborted).toBe(true);
    expect(sessionController(REF).getState().status).toBe('detached');

    view.rerender(<Viewer label="dock" />);
    await settle();
    expect(screen.getByTestId('dock').isSameNode(node)).toBe(true);
    expect(opened).toBe(2);
    expect(screen.getByTestId('dock')).toHaveTextContent('streaming');
    view.unmount();
  });
});
