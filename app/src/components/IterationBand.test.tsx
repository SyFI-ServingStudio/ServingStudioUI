import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useViz } from '../store';
import IterationBand from './IterationBand';

const iterationFixture = vi.hoisted(() => {
  const iters = [
    {
      id: 0,
      timeMs: 100,
      prefillTokens: 32,
      decodeRequests: 0,
      batchTokens: 32,
      phase: 'prefill' as const,
    },
    {
      id: 1,
      timeMs: 200,
      prefillTokens: 8,
      decodeRequests: 8,
      batchTokens: 16,
      phase: 'mixed' as const,
    },
    {
      id: 2,
      timeMs: 300,
      prefillTokens: 0,
      decodeRequests: 12,
      batchTokens: 12,
      phase: 'decode' as const,
    },
  ];
  return {
    iters,
    worker: { id: '0', ref: { poolTag: 'attn', workerId: '0' } },
    timeline: {
      iters,
      ref: { prefillTokens: 1, decodeRequests: 1, batchTokens: 1 },
      spanMs: 400,
    },
  };
});

vi.mock('../application/ActiveRunProvider', () => ({ useActiveRun: () => ({}) }));

vi.mock('../application/runSelection', () => ({
  currentWorker: () => iterationFixture.worker,
  iterTimeline: () => iterationFixture.timeline,
  currentIter: (_run: unknown, selection: { cursorMs: number | null }) => {
    const cursorMs = selection.cursorMs;
    if (cursorMs == null) return null;
    return iterationFixture.iters.reduce((nearest, iteration) =>
      Math.abs(iteration.timeMs - cursorMs) < Math.abs(nearest.timeMs - cursorMs)
        ? iteration
        : nearest,
    );
  },
}));

beforeEach(() => {
  useViz.setState({ workerKey: null, cursorMs: null });
});

describe('IterationBand interaction semantics', () => {
  it('provides a named range for keyboard-accessible minimap navigation', () => {
    render(<IterationBand />);

    const minimap = screen.getByRole('slider', {
      name: 'Jump to an iteration for worker attn/0',
    });
    expect(minimap).toHaveAttribute('aria-valuetext', 'No step selected');
    expect(minimap).toHaveAttribute('type', 'range');

    minimap.focus();
    expect(minimap).toHaveFocus();
    fireEvent.change(minimap, { target: { value: '2' } });
    expect(useViz.getState().cursorMs).toBe(300);
    expect(minimap).toHaveAttribute('aria-valuetext', 'Step 2 of 2, decode');
    expect(screen.getByRole('button', { name: /Step 2, decode/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
