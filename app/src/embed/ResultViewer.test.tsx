import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import summaryJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/summary.json';
import sloGeneralJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';
import { ResultViewer } from './ResultViewer';

const ID = 'r_embedded';

function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  shadow.append(container);
  return { host, shadow, container };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// A catalog naming the result (unless `catalog` is false, as for a page that
// forwards only the result's own routes), and the headline's summary and
// latency as a run's Analyzer serves them; every other read answers 404,
// which the pages show as their own unavailable states.
function transport({ catalog = true } = {}) {
  const run = `/api/analyzer/v1/runs/${ID}/subjects`;
  const bodies: Record<string, unknown> = {
    ...(catalog && {
      '/api/analyzer/v1/runs': {
        protocol_version: 1,
        generated_at: '2026-09-30T00:00:00Z',
        runs: [{ run_id: ID, display_name: `20260930_1_${'llama3_dense'}` }],
      },
    }),
    [`${run}/summary/report`]: summaryJson,
    [`${run}/slo-general/payload`]: sloGeneralJson,
  };
  return vi.fn(async (url: string) =>
    url in bodies ? json(bodies[url]) : json({ error: 'not found' }, 404),
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

  it('shows the name the page gives and reads no catalog', async () => {
    const { container } = mount();
    const read = transport();
    render(
      <ResultViewer
        kind="prediction"
        id="p_1"
        displayName="Llama 3 8B, tp_size 1"
        transport={read}
        onClose={() => {}}
      />,
      { container },
    );
    const view = within(container);
    expect(await view.findByText('Llama 3 8B, tp_size 1')).toBeTruthy();
    await waitFor(() => expect(read).toHaveBeenCalled());
    for (const [url] of read.mock.calls)
      expect(url).toMatch(/^\/api\/analyzer\/v1\/predictions\/p_1\//);
  });

  it("names a run's headline as the page does, reading only the run's routes", async () => {
    const { container } = mount();
    const read = transport({ catalog: false });
    render(
      <ResultViewer
        kind="run"
        id={ID}
        displayName="Llama 3.1 8B · TP, tp_size 1"
        transport={read}
        onClose={() => {}}
      />,
      { container },
    );
    const headline = await within(container).findByTestId('run-headline');
    expect(within(headline).getAllByText('Llama 3.1 8B · TP, tp_size 1').length).toBeGreaterThan(0);
    expect(within(headline).queryByText(ID)).toBeNull();
    const urls = read.mock.calls.map(([url]) => url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url).toMatch(new RegExp(`^/api/analyzer/v1/runs/${ID}/`));
  });

  it('offers no way to the catalog, which it does not show', async () => {
    const { container } = mount();
    render(<ResultViewer kind="run" id={ID} transport={transport()} onClose={() => {}} />, {
      container,
    });
    const view = within(container);
    await waitFor(() => expect(view.getByTestId('run-headline')).toBeTruthy());
    expect(view.queryByRole('button', { name: 'Return to aggregate overview' })).toBeNull();
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
      window.history.pushState(null, '', '#/chat/new?w=w_main');
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
