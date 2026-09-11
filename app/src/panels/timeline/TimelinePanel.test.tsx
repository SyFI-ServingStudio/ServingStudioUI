import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Location, Navigate } from '../../location';
import { RunTimelinePanel } from './TimelinePanel';

vi.mock('../../ui/controls/EChart', () => ({
  default: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

const LOCATION: Extract<Location, { view: 'result' }> = {
  view: 'result',
  ref: { kind: 'run', workspace: 'w_main', id: 'run-1' },
  focus: { path: [], panel: null, options: {}, cursorMs: null },
  chat: null,
};

const CONCURRENCY_PAYLOAD = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/test-run',
    request_count: 7,
    span_ms: 1_000,
    bins: 2,
    max_points: 512,
    aggregation: 'equal-width time-weighted mean',
  },
  t_ms: [500, 1_000],
  active: [1.25, 2.5],
  peak: 4,
  definitions: {
    scope: 'run',
    active: 'time-weighted mean active requests',
    t_ms: 'right edge of each bucket in milliseconds',
    peak: 'exact event-sweep peak',
    binning: 'equal-width bins',
  },
};

function show(fetchResult: Response, navigate: Navigate = vi.fn()) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResult));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={query}>
      <RunTimelinePanel location={LOCATION} navigate={navigate} />
    </QueryClientProvider>,
  );
  return navigate;
}

afterEach(() => vi.unstubAllGlobals());

describe('RunTimelinePanel', () => {
  it('keeps drag state local and replaces the URL only when the cursor is committed', async () => {
    const navigate = show(Response.json(CONCURRENCY_PAYLOAD));
    const slider = await screen.findByRole('slider', { name: 'Simulation time cursor' });

    expect(screen.getByText('aggregate · peak 4')).toBeVisible();
    fireEvent.change(slider, { target: { value: '750' } });
    // Equidistant samples keep the earlier point, as the old scrubber did.
    expect(screen.getByText('t = 0.75s · 1.25 active')).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ focus: expect.objectContaining({ cursorMs: 750 }) }),
      'replace',
    );
  });

  it('commits the last local value when a pointer interaction is cancelled', async () => {
    const navigate = show(Response.json(CONCURRENCY_PAYLOAD));
    const slider = await screen.findByRole('slider', { name: 'Simulation time cursor' });

    fireEvent.change(slider, { target: { value: '250' } });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.pointerCancel(slider);

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ focus: expect.objectContaining({ cursorMs: 250 }) }),
      'replace',
    );
  });

  it('preserves the old keyboard order and aggregate action', async () => {
    const user = userEvent.setup();
    const navigate = show(Response.json(CONCURRENCY_PAYLOAD));
    await screen.findByText('aggregate · peak 4');

    await user.tab();
    expect(screen.getByRole('button', { name: 'All' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('slider', { name: 'Simulation time cursor' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ focus: expect.objectContaining({ cursorMs: null }) }),
      'replace',
    );
  });

  it('commits only keys that change a native range control', async () => {
    const navigate = show(Response.json(CONCURRENCY_PAYLOAD));
    const slider = await screen.findByRole('slider', { name: 'Simulation time cursor' });

    fireEvent.change(slider, { target: { value: '501' } });
    fireEvent.keyUp(slider, { key: 'Shift' });
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ focus: expect.objectContaining({ cursorMs: 501 }) }),
      'replace',
    );
  });

  it('keeps a missing subject in the old timeline card', async () => {
    show(new Response('', { status: 410, statusText: 'Gone' }));
    expect(
      await screen.findByText(/^Analyzer subject concurrency is not generated\./),
    ).toBeVisible();
    expect(screen.getByTestId('run-timeline')).toHaveTextContent('Timeline');
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('drops a conflicting operation path when it commits a free cursor', async () => {
    const navigate = vi.fn();
    const operationLocation: Extract<Location, { view: 'result' }> = {
      ...LOCATION,
      focus: {
        ...LOCATION.focus,
        path: [
          { at: 'pool', role: 'decode' },
          { at: 'worker', id: '1' },
          { at: 'operation', iter: '2', batch: '3', op: '4' },
          { at: 'leaf', id: 5 },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(CONCURRENCY_PAYLOAD)));
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={query}>
        <RunTimelinePanel location={operationLocation} navigate={navigate} />
      </QueryClientProvider>,
    );
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '500' } });
    fireEvent.pointerUp(slider);

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: expect.objectContaining({
          path: [
            { at: 'pool', role: 'decode' },
            { at: 'worker', id: '1' },
          ],
          cursorMs: 500,
        }),
      }),
      'replace',
    );
  });

  it('follows a cursor changed by browser navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(CONCURRENCY_PAYLOAD)));
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const navigate = vi.fn();
    const at500 = { ...LOCATION, focus: { ...LOCATION.focus, cursorMs: 500 } };
    const view = render(
      <QueryClientProvider client={query}>
        <RunTimelinePanel location={at500} navigate={navigate} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('t = 0.50s · 1.25 active')).toBeVisible();

    const at1000 = { ...LOCATION, focus: { ...LOCATION.focus, cursorMs: 1_000 } };
    view.rerender(
      <QueryClientProvider client={query}>
        <RunTimelinePanel location={at1000} navigate={navigate} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('t = 1.00s · 2.5 active')).toBeVisible();
  });
});
