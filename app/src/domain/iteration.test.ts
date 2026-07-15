import { describe, expect, it } from 'vitest';

import { nearestIteration, type IterTimeline } from './iteration';

const timeline: IterTimeline = {
  spanMs: 400,
  iters: [
    {
      id: 0,
      timeMs: 100,
      prefillTokens: 8,
      decodeRequests: 0,
      batchTokens: 8,
      phase: 'prefill',
    },
    {
      id: 1,
      timeMs: 200,
      prefillTokens: 0,
      decodeRequests: 4,
      batchTokens: 4,
      phase: 'decode',
    },
  ],
};

describe('nearestIteration', () => {
  it.each([
    [0, 0],
    [149, 0],
    [150, 0],
    [151, 1],
    [500, 1],
  ])('selects the nearest immutable Analyzer step at %sms', (timeMs, expectedId) => {
    expect(nearestIteration(timeline, timeMs)?.id).toBe(expectedId);
  });

  it('returns null for a valid empty index page', () => {
    expect(nearestIteration({ iters: [], spanMs: 0 }, 10)).toBeNull();
  });
});
