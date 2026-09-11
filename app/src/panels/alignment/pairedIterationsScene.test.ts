import { describe, expect, it } from 'vitest';

import type {
  AlignmentIterationSeries,
  AlignmentPairedIteration,
} from '../../artifacts/schema/alignmentTypes';
import { PLOT, pairedLayout, pairedSeries, type PairedLayout } from './pairedIterationsModel';
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
    measuredKernelSumMs: measuredMs,
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
  sequenceDetail: null,
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
    expect(panels[0].series).toHaveLength(2);
    expect(panels[1].clamp).toBe(true);
    expect(panels[2].clamp).toBe(false);
  });
});

describe('pairedScene', () => {
  it('labels timing and difference axes with their units', () => {
    const drawn = texts(scene.shapes).join(' ').toLowerCase();
    expect(drawn).toMatch(/kernel time.*\(ms\)/);
    expect(drawn).toMatch(/relative diff.*\(%\)/);
    expect(drawn).toMatch(/cumulative diff.*\(%\)/);
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
    expect(clips.length).toBeGreaterThan(0);
    expect(zoomed.shapes.filter((shape) => shape.kind === 'unclip')).toHaveLength(clips.length);
    for (const clip of clips) {
      expect(clip.x).toBe(PLOT.left);
      expect(clip.width).toBe(zoomedLayout.plotWidth);
    }
  });
});

describe('hoverShapes', () => {
  it('names the hovered iteration and marks it on every panel', () => {
    const shapes = hoverShapes(paired, family, layout, 40);
    expect(texts(shapes)).toEqual([`decode · iteration ${iterations[40].iterationId}`]);
    // one per lane in the value panel, plus the two derived panels
    expect(shapes.filter((shape) => shape.kind === 'dot')).toHaveLength(4);
  });
});
