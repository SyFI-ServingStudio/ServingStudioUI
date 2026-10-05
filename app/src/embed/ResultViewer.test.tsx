import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import runDescriptorJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/run_descriptor.json';
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

// Only a run's own routes, as the embedding page forwards them: its
// descriptor, in a workspace an Analyzer over a static logs root names, and
// the headline's summary and latency. Every other read answers 404, which
// the pages show as their own unavailable states.
const WORKSPACE = 'w_root_0';
function transport() {
  const run = `/api/analyzer/v1/runs/${ID}`;
  const bodies: Record<string, unknown> = {
    [`${run}/descriptor`]: { ...runDescriptorJson, run_id: ID, workspace_id: WORKSPACE },
    [`${run}/subjects/summary/report`]: summaryJson,
    [`${run}/subjects/slo-general/payload`]: sloGeneralJson,
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
      expect(read).toHaveBeenCalledWith(
        `/api/analyzer/v1/runs/${ID}/descriptor`,
        expect.anything(),
      ),
    );
    // The page's styles are written in the shadow root, none in the document.
    expect(shadow.querySelectorAll('style[data-emotion^="ssui"]').length).toBeGreaterThan(0);
    expect(document.head.querySelectorAll('style[data-emotion^="ssui"]').length).toBe(0);
    // The result's address is the page's hash, on the page's own path.
    expect(window.location.pathname).toBe('/models.html');
    expect(window.location.hash).toMatch(new RegExp(`^#/result/run/${ID}\\b`));
    // In the workspace the run's descriptor names, which the pages check it
    // against.
    expect(new URLSearchParams(window.location.hash.split('?')[1]).get('w')).toBe(WORKSPACE);
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
    // Besides the prediction's own routes, only the kernel kinds' DOC names,
    // which the embedding page forwards too.
    for (const [url] of read.mock.calls)
      expect(url).toMatch(/^\/api\/analyzer\/v1\/(predictions\/p_1\/|kernel-kinds$)/);
  });

  it("names a run's headline as the page does, reading only the run's routes", async () => {
    const { container } = mount();
    const read = transport();
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
    for (const url of urls) {
      expect(url).toMatch(new RegExp(`^/api/analyzer/v1/(runs/${ID}/|kernel-kinds$)`));
    }
  });

  it('names the result by no id when the page gives no name', async () => {
    const { container } = mount();
    const read = transport();
    render(<ResultViewer kind="prediction" id="p_1" transport={read} onClose={() => {}} />, {
      container,
    });
    const header = await within(container).findByRole('banner');
    expect(within(header).getByRole('heading', { name: 'Timing prediction' })).toBeTruthy();
    expect(header.textContent).not.toContain('p_1');
    await waitFor(() => expect(read).toHaveBeenCalled());
    for (const [url] of read.mock.calls)
      expect(url).toMatch(/^\/api\/analyzer\/v1\/(predictions\/p_1\/|kernel-kinds$)/);
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
