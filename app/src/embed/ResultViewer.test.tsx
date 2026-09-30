import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultViewer } from './ResultViewer';

const ID = 'run_browser_1';

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  return { host, shadow, container };
}

// A catalog naming the result; every other read answers 404, which the pages
// show as their own unavailable states.
function transport() {
  return vi.fn(async (url: string) =>
    url === '/api/analyzer/v1/runs'
      ? new Response(
          JSON.stringify({
            protocol_version: 1,
            generated_at: '2026-09-30T00:00:00Z',
            runs: [{ run_id: ID, display_name: `20260930_1_${'llama3_dense'}` }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      : new Response('{"error":"not found"}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/models.html?arch=x');
  document.documentElement.style.fontSize = '';
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe('ResultViewer', () => {
  it('renders the result in its shadow root, reading through the transport', async () => {
    const { shadow, container } = mount();
    const read = transport();
    render(<ResultViewer kind="run" id={ID} transport={read} onClose={() => {}} />, {
      container,
    });

    const view = within(container);
    await waitFor(() => expect(view.getByRole('heading', { name: 'Run' })).toBeTruthy());
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith('/api/analyzer/v1/runs', expect.anything()),
    );
    // The page's styles are written in the shadow root, none in the document.
    expect(shadow.querySelectorAll('style[data-emotion^="ssui"]').length).toBeGreaterThan(0);
    expect(document.head.querySelectorAll('style[data-emotion^="ssui"]').length).toBe(0);
    // The result's address is the page's hash, on the page's own path.
    expect(window.location.pathname).toBe('/models.html');
    expect(window.location.hash).toMatch(new RegExp(`^#/result/run/${ID}\\b`));
    expect(document.documentElement.style.fontSize).toBe('112.5%');
  });

  it('clears the hash and the root font size when it closes', async () => {
    const { container } = mount();
    const { unmount } = render(
      <ResultViewer kind="run" id={ID} transport={transport()} onClose={() => {}} />,
      { container },
    );
    await waitFor(() => expect(window.location.hash).not.toBe(''));
    unmount();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?arch=x');
    expect(document.documentElement.style.fontSize).toBe('');
  });

  it('closes when the page goes back past its first address', async () => {
    const { container } = mount();
    const onClose = vi.fn();
    render(<ResultViewer kind="run" id={ID} transport={transport()} onClose={onClose} />, {
      container,
    });
    await waitFor(() => expect(window.location.hash).not.toBe(''));
    act(() => {
      window.history.replaceState(null, '', '/models.html?arch=x');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('says a view outside the result needs the application', async () => {
    const { container } = mount();
    render(<ResultViewer kind="run" id={ID} transport={transport()} onClose={() => {}} />, {
      container,
    });
    await waitFor(() => expect(window.location.hash).not.toBe(''));
    act(() => {
      window.history.pushState(null, '', '#/chat/new?w=w_browser');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() =>
      expect(within(container).getByText(/needs the ServingStudio application/)).toBeTruthy(),
    );
  });

  it('closes from its close button', async () => {
    const { container } = mount();
    const onClose = vi.fn();
    render(<ResultViewer kind="prediction" id="p_1" transport={transport()} onClose={onClose} />, {
      container,
    });
    const close = await within(container).findByRole('button', { name: 'Close' });
    act(() => close.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(within(container).getByRole('heading', { name: 'Timing prediction' })).toBeTruthy();
  });
});
