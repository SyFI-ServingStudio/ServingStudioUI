import { describe, expect, it } from 'vitest';

import {
  barWidthPct,
  boardHighlight,
  joinIsActive,
  modelledRowGaps,
  nextSelection,
  ribbonCurves,
  sameGeometry,
  RIBBON_ACTIVE_WIDTH,
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
  it('leaves the left card level and arrives at the right one level', () => {
    const [curve] = ribbonCurves([joins[0]], [10], [4, 40], 100, () => false);
    expect(curve).toMatchObject({
      startX: 0,
      startY: 10,
      controlOutY: 10,
      controlInY: 40,
      endX: 100,
      endY: 40,
    });
    expect(curve.controlOutX).toBeLessThan(curve.controlInX);
  });

  it('drops a join whose endpoints have not been measured yet', () => {
    expect(ribbonCurves(joins, [undefined, 20], [undefined, 40], 100, () => false)).toHaveLength(0);
  });

  it('draws the live ribbons last so a bundle cannot bury them', () => {
    const curves = ribbonCurves(joins, [10, 20], [30, 40], 100, (join) => join.measuredIndex === 0);
    expect(curves.map((curve) => curve.active)).toEqual([false, true]);
  });

  it('keeps the stroke widths apart so a live ribbon reads as one', () => {
    expect(RIBBON_ACTIVE_WIDTH).toBeGreaterThan(1);
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
  it('measures a card against the longest card on the board', () => {
    expect(barWidthPct(1, 4)).toBe(25);
  });

  it('draws nothing for a cost the report does not carry', () => {
    expect(barWidthPct(null, 4)).toBe(0);
    expect(barWidthPct(1, 0)).toBe(0);
  });
});

describe('modelledRowGaps', () => {
  it('spreads the ordered modelled lane toward the mean linked positions', () => {
    const gaps = modelledRowGaps(
      [
        { measuredIndex: 0, modelledIndex: 0, color: '@first' },
        { measuredIndex: 1, modelledIndex: 2, color: '@last' },
      ],
      [37, 97],
      3,
      { cardHeight: 10, cardGap: 2, groupHeaderHeight: 10 },
    );
    const firstPackedCenter = 10 + 2 + 5;
    const separation = 10 + 2;
    const centers = [
      firstPackedCenter + gaps[0],
      firstPackedCenter + separation + gaps[0] + gaps[1],
      firstPackedCenter + separation * 2 + gaps[0] + gaps[1] + gaps[2],
    ];
    expect(centers[0]).toBe(37);
    expect(centers[2]).toBe(97);
    expect(centers[1]).toBeGreaterThan(centers[0]);
    expect(centers[2]).toBeGreaterThan(centers[1]);
  });

  it('averages several measured cards joined to one slot', () => {
    const gaps = modelledRowGaps(
      [
        { measuredIndex: 0, modelledIndex: 0, color: '@one' },
        { measuredIndex: 1, modelledIndex: 0, color: '@two' },
      ],
      [30, 50],
      1,
      { cardHeight: 10, cardGap: 2, groupHeaderHeight: 10 },
    );
    expect(gaps[0]).toBe(23);
  });

  it('minimizes total ordered mismatch instead of greedily carrying the first target forward', () => {
    const gaps = modelledRowGaps(
      [
        { measuredIndex: 0, modelledIndex: 0, color: '@first' },
        { measuredIndex: 1, modelledIndex: 1, color: '@second' },
      ],
      [50, 20],
      2,
      { cardHeight: 10, cardGap: 2, groupHeaderHeight: 10 },
    );
    const firstPackedCenter = 10 + 2 + 5;
    const separation = 10 + 2;
    const firstCenter = firstPackedCenter + gaps[0];
    const secondCenter = firstPackedCenter + separation + gaps[0] + gaps[1];
    expect(firstCenter).toBe(29);
    expect(secondCenter).toBe(41);
    expect(Math.abs(50 - firstCenter)).toBe(Math.abs(20 - secondCenter));
  });

  it('keeps an unlinked lane compact when there are no targets', () => {
    expect(
      modelledRowGaps([], [30], 2, { cardHeight: 10, cardGap: 2, groupHeaderHeight: 10 }),
    ).toEqual([0, 0]);
  });
});

describe('sameGeometry', () => {
  const geometry = { measuredCenterY: [1, undefined], modelledCenterY: [2], height: 40 };

  it('holds a re-measurement that changed nothing', () => {
    expect(sameGeometry(geometry, { ...geometry, measuredCenterY: [1, undefined] })).toBe(true);
  });

  it('reports a moved card and a resized column', () => {
    expect(sameGeometry(geometry, { ...geometry, measuredCenterY: [3, undefined] })).toBe(false);
    expect(sameGeometry(geometry, { ...geometry, height: 41 })).toBe(false);
  });
});
