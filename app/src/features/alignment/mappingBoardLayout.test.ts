import { describe, expect, it } from 'vitest';

import {
  barWidthPct,
  boardHighlight,
  joinIsActive,
  nextSelection,
  ribbonCurves,
} from './mappingBoardLayout';
import type { BoardJoin, BoardLanes } from './mappingBoardModel';

const joins: readonly BoardJoin[] = [
  { measuredIndex: 0, modelledIndex: 1, color: '@gemm' },
  { measuredIndex: 1, modelledIndex: 0, color: '@comm' },
];

const lanes = {
  measured: [{ id: 'm0' }, { id: 'm1' }],
  modelled: [{ id: 's0' }, { id: 's1' }],
} as unknown as BoardLanes;

describe('ribbonCurves', () => {
  it('drops a join whose endpoints have not been measured yet', () => {
    expect(ribbonCurves(joins, [undefined, 20], [undefined, 40], 100, () => false)).toHaveLength(0);
  });
});

describe('boardHighlight and joinIsActive', () => {
  it('lights the far side of every ribbon a selected card carries', () => {
    const highlight = boardHighlight(lanes, joins, new Set(['m1']));
    expect([...highlight.joined]).toEqual(['s0']);
    expect(highlight.hasSelection).toBe(true);
  });

  it('works from either side of the gutter', () => {
    expect([...boardHighlight(lanes, joins, new Set(['s1'])).joined]).toEqual(['m0']);
  });

  it('marks a ribbon live from either of its ends', () => {
    const active = joinIsActive(lanes, new Set(['s1']));
    expect(active(joins[0])).toBe(true);
    expect(active(joins[1])).toBe(false);
  });
});

describe('nextSelection', () => {
  it('replaces the selection on a plain click', () => {
    expect([...nextSelection(new Set(['m0', 's1']), 'm1', false)]).toEqual(['m1']);
  });

  it('clears when the only selected card is clicked again', () => {
    expect([...nextSelection(new Set(['m0']), 'm0', false)]).toEqual([]);
  });

  it('adds and removes one card on a modified click', () => {
    expect([...nextSelection(new Set(['m0']), 's1', true)]).toEqual(['m0', 's1']);
    expect([...nextSelection(new Set(['m0', 's1']), 'm0', true)]).toEqual(['s1']);
  });
});

describe('barWidthPct', () => {
  it('draws nothing for a cost the report does not carry', () => {
    expect(barWidthPct(null, 4)).toBe(0);
    expect(barWidthPct(1, 0)).toBe(0);
  });
});
