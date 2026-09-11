import { describe, expect, it } from 'vitest';

import { matchingLines, stepMatch } from './search';

describe('matchingLines', () => {
  it('ignores case', () => {
    expect(matchingLines('Total TPS\ntotal tps\n', 'TOTAL')).toEqual([1, 2]);
  });

  it('treats a blank query as no search at all', () => {
    expect(matchingLines('alpha\n', '')).toEqual([]);
    expect(matchingLines('alpha\n', '   ')).toEqual([]);
  });
});

describe('stepMatch', () => {
  it('wraps forwards and backwards', () => {
    expect(stepMatch(3, 2, 1)).toBe(0);
    expect(stepMatch(3, 0, -1)).toBe(2);
  });

  it('stays put when there is nothing to step through', () => {
    expect(stepMatch(0, 0, 1)).toBe(0);
  });
});
