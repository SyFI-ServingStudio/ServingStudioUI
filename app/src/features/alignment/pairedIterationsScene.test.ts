import { describe, expect, it } from 'vitest';

import type { AlignmentIterationSeries, AlignmentPairedIteration } from '../../domain/alignment';
import {
  PAIRED_SERIES_COLOR,
  PLOT,
  iterationToX,
  pairedLayout,
  pairedSeries,
  type PairedLayout,
} from './pairedIterationsModel';
import {
  hoverShapes,
  pairedScene,
  panelDefinitions,
  type PlotShape,
} from './pairedIterationsScene';

function iteration(
  iterationId: number,
  iterationType: string,
  drift: number,
): AlignmentPairedIteration {
  const measuredMs = 4 + (iterationId % 3);
  const simulatedMs = measuredMs * (1 + drift);
  const relativeDiffPct = drift * 100;
  return {
    iterationId,
    caseIndex: iterationId,
    iterationType,
    stage: iterationType,
    measuredMs,
    simulatedMs,
    deltaMs: simulatedMs - measuredMs,
    relativeDiffPct,
    cumulativeDeltaMs: simulatedMs - measuredMs,
    cumulativeRelativeDiffPct: relativeDiffPct,
    measuredBusyUnionMs: measuredMs,
    measuredGpuCycleMs: measuredMs * 2,
    simulatedGpuCycleMs: simulatedMs * 2,
    gpuCycleDeltaMs: (simulatedMs - measuredMs) * 2,
    gpuCycleRelativeDiffPct: relativeDiffPct,
    gpuCycleCumulativeDeltaMs: (simulatedMs - measuredMs) * 2,
    gpuCycleCumulativeRelativeDiffPct: relativeDiffPct,
  };
}

/** A capture long enough to force the per-column band, with a handful of
 * transition iterations far enough out to leave the clipped panel. */
const iterations = Array.from({ length: 2400 }, (_value, index) =>
  iteration(
    index + 6,
    index % 40 === 7 ? 'mixed' : index === 3 ? 'prefill' : 'decode',
    index % 300 === 11 ? 12 : ((index % 17) - 8) / 40,
  ),
);

const series: AlignmentIterationSeries = {
  definitions: {},
  meta: { recommendedGpuTimeMultiplier: 1.3, measuredPhases: ['forward'] },
  iterations,
  sequences: null,
  breakdownDetail: null,
};

const paired = pairedSeries(series);
const family = paired.families[0];
const layout: PairedLayout = pairedLayout(family);
const scene = pairedScene(paired, family, layout);

const texts = (shapes: readonly PlotShape[]): string[] =>
  shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []));

describe('panelDefinitions', () => {
  it('keeps the two lanes in one panel and each derived series in its own', () => {
    const panels = panelDefinitions(family);
    expect(panels.map((panel) => panel.key)).toEqual(['value', 'relative', 'cumulative']);
    expect(panels[0].series.map((entry) => entry.color)).toEqual([
      PAIRED_SERIES_COLOR.measured,
      PAIRED_SERIES_COLOR.modelled,
    ]);
    expect(panels[1].clamp).toBe(true);
    expect(panels[2].clamp).toBe(false);
  });
});

describe('pairedScene', () => {
  it('draws in the fixed coordinate space the layout was measured in', () => {
    expect(scene.width).toBe(PLOT.width);
    expect(scene.height).toBe(layout.height);
  });

  it('names every axis, uppercased the way the design sets them', () => {
    const drawn = texts(scene.shapes);
    expect(drawn).toContain('ITERATION TYPE · RAREST TYPE OWNS A SHARED PIXEL');
    expect(drawn).toContain('KERNEL TIME (MS)');
    expect(drawn).toContain('RELATIVE DIFF (%)');
    expect(drawn).toContain('CUMULATIVE DIFF (%)');
    expect(drawn).toContain('MEASURED ITERATION ID');
  });

  it('labels the iteration axis with measured ids, not with array positions', () => {
    expect(texts(scene.shapes)).toContain(String(iterations[0].iterationId));
    expect(texts(scene.shapes)).toContain(String(iterations[2000].iterationId));
  });

  it('counts the points the relative panel drew on its edge and says so', () => {
    const footnote = texts(scene.shapes).find((text) => text.includes('drawn on the edge'));
    expect(footnote).toMatch(/^\d+ points? outside .+ … .+, drawn on the edge$/);
  });

  it('reduces a long capture to a band and a mean line, not to one point per iteration', () => {
    expect(layout.dense).toBe(true);
    const polygons = scene.shapes.filter((shape) => shape.kind === 'polygon');
    expect(polygons.length).toBe(4);
    for (const polygon of polygons) {
      expect(polygon.points.length).toBeLessThanOrEqual(layout.columnCount * 2);
    }
    expect(scene.shapes.some((shape) => shape.kind === 'dot')).toBe(false);
  });

  it('gives the rare iteration types a colour of their own in the strip', () => {
    const stripFills = new Set(
      scene.shapes.flatMap((shape) =>
        shape.kind === 'rect' && shape.y === PLOT.top && shape.fill !== undefined
          ? [shape.fill]
          : [],
      ),
    );
    expect(stripFills.size).toBe(paired.typeNames.length);
  });
});

describe('a zoomed iteration axis', () => {
  const window = { start: 100, end: 140 };
  const zoomedLayout = pairedLayout(family, window);
  const zoomed = pairedScene(paired, family, zoomedLayout);
  /** The x-axis labels: the row of ids under the last panel. */
  const axisLabels = (shapes: readonly PlotShape[]): number[] =>
    shapes.flatMap((shape) =>
      shape.kind === 'text' && shape.y === zoomedLayout.axisY + 15 ? [Number(shape.text)] : [],
    );

  it('recomputes its ticks from the window rather than stretching them', () => {
    const labels = axisLabels(zoomed.shapes);
    expect(labels.length).toBeGreaterThan(1);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(label).toBeGreaterThanOrEqual(iterations[window.start].iterationId);
      expect(label).toBeLessThanOrEqual(iterations[window.end].iterationId);
    }
  });

  it('leaves the band behind once the window fits inside the columns', () => {
    expect(zoomedLayout.dense).toBe(false);
    expect(zoomedLayout.visibleCount).toBe(41);
    expect(zoomed.shapes.some((shape) => shape.kind === 'polygon')).toBe(false);
    expect(zoomed.shapes.some((shape) => shape.kind === 'dot')).toBe(true);
  });

  it('draws the data inside the plot, so nothing lands on the gutters', () => {
    const clips = zoomed.shapes.filter((shape) => shape.kind === 'clip');
    // The type strip and one per panel.
    expect(clips).toHaveLength(4);
    expect(zoomed.shapes.filter((shape) => shape.kind === 'unclip')).toHaveLength(clips.length);
    for (const clip of clips) {
      expect(clip.x).toBe(PLOT.left);
      expect(clip.width).toBe(zoomedLayout.plotWidth);
    }
  });

  it('spreads the window across the whole plot width', () => {
    expect(iterationToX(zoomedLayout, window.start)).toBeCloseTo(PLOT.left, 9);
    expect(iterationToX(zoomedLayout, window.end)).toBeCloseTo(PLOT.width - PLOT.right, 9);
  });
});

describe('hoverShapes', () => {
  it('draws nothing while the pointer is away', () => {
    expect(hoverShapes(paired, family, layout, null)).toEqual([]);
  });

  it('names the hovered iteration and marks it on every panel', () => {
    const shapes = hoverShapes(paired, family, layout, 40);
    expect(texts(shapes)).toEqual([`decode · iteration ${iterations[40].iterationId}`]);
    // one per lane in the value panel, plus the two derived panels
    expect(shapes.filter((shape) => shape.kind === 'dot')).toHaveLength(4);
  });

  it('keeps the pill inside the plot at either end', () => {
    for (const index of [0, layout.count - 1]) {
      const pill = hoverShapes(paired, family, layout, index).find(
        (shape) => shape.kind === 'rect' && shape.radius === 6,
      );
      expect(pill?.kind).toBe('rect');
      if (pill?.kind !== 'rect') throw new Error('the hover pill is a rounded rect');
      expect(pill.x).toBeGreaterThanOrEqual(PLOT.left);
      expect(pill.x + pill.width).toBeLessThanOrEqual(PLOT.width - PLOT.right + 0.001);
    }
  });
});
