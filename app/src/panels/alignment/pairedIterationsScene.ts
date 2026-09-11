import { tokens } from '../../ui/theme';
import {
  PAIRED_SERIES_COLOR,
  PLOT,
  PLOT_AXIS_COLOR,
  PLOT_AXIS_NAME_COLOR,
  PLOT_GRID_COLOR,
  PLOT_LABEL_COLOR,
  axisTickLabel,
  bandAndMean,
  iterationToX,
  iterationTypeShare,
  iterationTypeStrip,
  niceTicks,
  panelScale,
  pixelColumns,
  polylines,
  type PairedFamily,
  type PairedLayout,
  type PairedSeries,
  type PanelKey,
  type PlotPoint,
} from './pairedIterationsModel';
import { iterationTypeColor } from './iterationPalette';

/**
 * §01's plot as a list of shapes.
 *
 * The card draws on a 2D canvas — a thousand-column band with three panels is
 * far past what a DOM or an ECharts series would carry at hover rates — and
 * this file is the seam that keeps the drawing honest: every coordinate is
 * computed here, in a pure function a test can read, and the canvas does
 * nothing but stroke and fill what it is handed.
 *
 * The base scene depends only on the family and the layout; the hover overlay
 * is a separate, cheap list, so moving the pointer does not rebuild a
 * thousand-point band.
 */

export type PlotShape =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly fill?: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly radius?: number;
    }
  | {
      readonly kind: 'polygon';
      readonly points: readonly PlotPoint[];
      readonly fill: string;
      readonly alpha: number;
    }
  | {
      readonly kind: 'polyline';
      readonly points: readonly PlotPoint[];
      readonly stroke: string;
      readonly width: number;
      readonly dash?: readonly number[];
    }
  | {
      readonly kind: 'dot';
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly fill: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    }
  | {
      readonly kind: 'text';
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly fill: string;
      readonly size: number;
      readonly align: 'left' | 'center' | 'right';
      readonly weight?: number;
      /** Letter spacing in em, as the design's uppercase axis names carry. */
      readonly tracking?: number;
    }
  | {
      /**
       * Everything up to the matching `unclip` is drawn inside this rectangle.
       *
       * A zoomed axis places most of the capture outside the plot, and a band
       * or a line that ran on would paint straight over the tick labels in the
       * gutter. The two markers keep the scene one flat list — the alternative,
       * a second array of clipped shapes, would split every drawing helper in
       * two and lose the order shapes are layered in.
       */
      readonly kind: 'clip';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'unclip' };

export interface PairedScene {
  readonly width: number;
  readonly height: number;
  readonly shapes: readonly PlotShape[];
}

/** The plot's own rectangle at a given row, which is what data may be drawn in. */
const clipToPlot = (layout: PairedLayout, y: number, height: number): PlotShape => ({
  kind: 'clip',
  x: PLOT.left,
  y,
  width: layout.plotWidth,
  height,
});

const AXIS_NAME_SIZE = 11.5;
const AXIS_LABEL_SIZE = 11.5;
const AXIS_NAME_TRACKING = 0.1;
const SERIES_LINE_WIDTH = 1.6;
const BAND_ALPHA = 0.2;
/** The design's axis names are uppercased by CSS; a canvas has to do it. */
const axisName = (text: string): string => text.toUpperCase();

interface PanelDefinition {
  readonly key: PanelKey;
  readonly label: string;
  readonly tickCount: number;
  readonly series: readonly {
    readonly values: readonly (number | null)[];
    readonly color: string;
  }[];
  readonly zero: boolean;
  readonly clamp: boolean;
}

export function panelDefinitions(family: PairedFamily): readonly PanelDefinition[] {
  return [
    {
      key: 'value',
      label: family.unit,
      tickCount: 5,
      series: [
        { values: family.measured, color: PAIRED_SERIES_COLOR.measured },
        { values: family.simulated, color: PAIRED_SERIES_COLOR.modelled },
      ],
      zero: false,
      clamp: false,
    },
    {
      key: 'relative',
      label: 'relative diff (%)',
      tickCount: 4,
      series: [{ values: family.relative, color: PAIRED_SERIES_COLOR.relative }],
      zero: true,
      clamp: true,
    },
    {
      key: 'cumulative',
      label: 'cumulative diff (%)',
      tickCount: 4,
      series: [{ values: family.cumulative, color: PAIRED_SERIES_COLOR.cumulative }],
      zero: true,
      clamp: false,
    },
  ];
}

function stripShapes(series: PairedSeries, layout: PairedLayout): PlotShape[] {
  const shapes: PlotShape[] = [clipToPlot(layout, PLOT.top, PLOT.strip)];
  for (const run of iterationTypeStrip(series.iterationType, layout)) {
    shapes.push({
      kind: 'rect',
      x: PLOT.left + run.column,
      y: PLOT.top,
      width: run.width,
      height: PLOT.strip,
      fill: iterationTypeColor(series.typeNames[run.typeIndex], series.typeNames),
    });
  }
  shapes.push({ kind: 'unclip' });
  shapes.push({
    kind: 'rect',
    x: PLOT.left,
    y: PLOT.top,
    width: layout.plotWidth,
    height: PLOT.strip,
    stroke: PLOT_AXIS_COLOR,
    strokeWidth: 1,
  });
  shapes.push({
    kind: 'text',
    x: PLOT.left,
    y: PLOT.top - 9,
    text: axisName(
      layout.dense ? 'iteration type · rarest type owns a shared pixel' : 'iteration type',
    ),
    fill: PLOT_AXIS_NAME_COLOR,
    size: AXIS_NAME_SIZE,
    align: 'left',
    tracking: AXIS_NAME_TRACKING,
  });
  shapes.push({
    kind: 'text',
    x: PLOT.width - PLOT.right,
    y: PLOT.top - 9,
    text: iterationTypeShare(series.iterationType, series.typeNames),
    fill: PLOT_LABEL_COLOR,
    size: AXIS_LABEL_SIZE,
    align: 'right',
  });
  return shapes;
}

function panelShapes(
  panel: PanelDefinition,
  panelIndex: number,
  layout: PairedLayout,
): PlotShape[] {
  const top = layout.tops[panelIndex];
  const bottom = top + PLOT.panels[panelIndex].height;
  const toY = panelScale(layout, panelIndex, panel.key);
  const range = layout.ranges[panel.key];
  const shapes: PlotShape[] = [];

  for (const value of niceTicks(range[0], range[1], panel.tickCount)) {
    const y = toY(value);
    if (y < top - 0.5 || y > bottom + 0.5) continue;
    shapes.push({
      kind: 'polyline',
      points: [
        [PLOT.left, y],
        [PLOT.width - PLOT.right, y],
      ],
      stroke: PLOT_GRID_COLOR,
      width: 1,
    });
    shapes.push({
      kind: 'text',
      x: PLOT.left - 7,
      y: y + 3,
      text: axisTickLabel(value),
      fill: PLOT_LABEL_COLOR,
      size: AXIS_LABEL_SIZE,
      align: 'right',
    });
  }
  shapes.push({
    kind: 'polyline',
    points: [
      [PLOT.left, top],
      [PLOT.left, bottom],
    ],
    stroke: PLOT_AXIS_COLOR,
    width: 1,
  });

  // Fills first, then every mean line, so the series listed first ends up on
  // top rather than buried under the next one's band.
  const fills: PlotShape[] = [];
  const lines: PlotShape[] = [];
  const clampTo = panel.clamp ? range : null;
  let clampedTotal = 0;
  for (const entry of panel.series) {
    if (layout.dense) {
      const reduced = bandAndMean(pixelColumns(entry.values, layout), toY, clampTo);
      clampedTotal += reduced.clamped;
      if (reduced.band.length > 0) {
        fills.push({ kind: 'polygon', points: reduced.band, fill: entry.color, alpha: BAND_ALPHA });
      }
      if (reduced.mean.length > 0) {
        lines.push({
          kind: 'polyline',
          points: reduced.mean,
          stroke: entry.color,
          width: SERIES_LINE_WIDTH,
        });
      }
      continue;
    }
    const drawn = polylines(entry.values, layout, toY, clampTo);
    clampedTotal += drawn.clamped;
    for (const segment of drawn.segments) {
      lines.push({
        kind: 'polyline',
        points: segment.points,
        stroke: entry.color,
        width: SERIES_LINE_WIDTH,
      });
      if (layout.markers) {
        for (const [x, y] of segment.points) {
          lines.push({ kind: 'dot', x, y, radius: 1.7, fill: entry.color });
        }
      }
      for (const [x, y] of segment.clampedPoints) {
        // An arrowhead on the edge, pointing the way the value left the panel.
        const direction = y <= top + 1 ? 1 : -1;
        lines.push({
          kind: 'polyline',
          points: [
            [x - 3.4, y + direction * 3.8],
            [x + 3.4, y + direction * 3.8],
            [x, y],
            [x - 3.4, y + direction * 3.8],
          ],
          stroke: tokens.terra,
          width: 1.2,
        });
      }
    }
  }
  shapes.push(
    clipToPlot(layout, top, PLOT.panels[panelIndex].height),
    ...fills,
    ...[...lines].reverse(),
    { kind: 'unclip' },
  );

  // The zero reference goes over the data, or it is invisible inside a band.
  if (panel.zero && range[0] < 0 && range[1] > 0) {
    shapes.push({
      kind: 'polyline',
      points: [
        [PLOT.left, toY(0)],
        [PLOT.width - PLOT.right, toY(0)],
      ],
      stroke: PLOT_LABEL_COLOR,
      width: 1,
      dash: [3, 3],
    });
  }

  shapes.push({
    kind: 'text',
    x: PLOT.left,
    y: top - 9,
    text: axisName(panel.label),
    fill: PLOT_AXIS_NAME_COLOR,
    size: AXIS_NAME_SIZE,
    align: 'left',
    tracking: AXIS_NAME_TRACKING,
  });
  if (clampedTotal > 0) {
    shapes.push({
      kind: 'text',
      x: PLOT.width - PLOT.right,
      y: top - 9,
      text: `${clampedTotal} point${clampedTotal > 1 ? 's' : ''} outside ${axisTickLabel(range[0])} … ${axisTickLabel(range[1])}, drawn on the edge`,
      fill: tokens.terra,
      size: AXIS_LABEL_SIZE,
      align: 'right',
    });
  }
  return shapes;
}

function iterationAxisShapes(series: PairedSeries, layout: PairedLayout): PlotShape[] {
  const shapes: PlotShape[] = [
    {
      kind: 'polyline',
      points: [
        [PLOT.left, layout.axisY],
        [PLOT.width - PLOT.right, layout.axisY],
      ],
      stroke: PLOT_AXIS_COLOR,
      width: 1,
    },
  ];
  // Ticks are recomputed from the window, not stretched with it: a zoomed axis
  // whose labels still read the whole capture would be a ruler for a plot that
  // is no longer drawn. Two ticks can round onto one iteration once the window
  // is narrower than the tick step, and the second would print the same id at a
  // different x, so an ordinal is labelled once.
  const labelled = new Set<number>();
  for (const tick of niceTicks(layout.viewport.start, layout.viewport.end, 8)) {
    const index = Math.round(tick);
    if (index < 0 || index >= layout.count || labelled.has(index)) continue;
    labelled.add(index);
    shapes.push({
      kind: 'text',
      x: iterationToX(layout, index),
      y: layout.axisY + 15,
      text: String(series.iterationId[index]),
      fill: PLOT_LABEL_COLOR,
      size: AXIS_LABEL_SIZE,
      align: 'center',
    });
  }
  shapes.push({
    kind: 'text',
    x: (PLOT.left + PLOT.width - PLOT.right) / 2,
    y: layout.axisY + 25,
    text: axisName('measured iteration id'),
    fill: PLOT_AXIS_NAME_COLOR,
    size: AXIS_NAME_SIZE,
    align: 'center',
    tracking: AXIS_NAME_TRACKING,
  });
  return shapes;
}

export function pairedScene(
  series: PairedSeries,
  family: PairedFamily,
  layout: PairedLayout,
): PairedScene {
  const shapes: PlotShape[] = [...stripShapes(series, layout)];
  panelDefinitions(family).forEach((panel, panelIndex) => {
    shapes.push(...panelShapes(panel, panelIndex, layout));
  });
  shapes.push(...iterationAxisShapes(series, layout));
  return { width: PLOT.width, height: layout.height, shapes };
}

/** Roughly how wide the hover pill's mono label runs, at its own type size. */
const PILL_CHARACTER_WIDTH = 6.9;

export function hoverShapes(
  series: PairedSeries,
  family: PairedFamily,
  layout: PairedLayout,
  hoverIndex: number | null,
): readonly PlotShape[] {
  if (hoverIndex === null) return [];
  const x = iterationToX(layout, hoverIndex);
  const typeName = series.typeNames[series.iterationType[hoverIndex]];
  const typeColor = iterationTypeColor(typeName, series.typeNames);
  const shapes: PlotShape[] = [
    {
      kind: 'polyline',
      points: [
        [x, PLOT.top],
        [x, layout.axisY],
      ],
      stroke: tokens.ink,
      width: 1,
      dash: [2, 3],
    },
  ];

  // The hovered iteration is one column of the strip, which is not something a
  // pointer can resolve — so draw it again, oversized, and name its type.
  const markWidth = 11;
  const markPad = 5;
  shapes.push({
    kind: 'rect',
    x: x - markWidth / 2,
    y: PLOT.top - markPad,
    width: markWidth,
    height: PLOT.strip + markPad * 2,
    radius: 2.5,
    fill: typeColor,
    stroke: tokens.ink,
    strokeWidth: 1.5,
  });

  const label = `${typeName} · iteration ${series.iterationId[hoverIndex]}`;
  const pillWidth = label.length * PILL_CHARACTER_WIDTH + 20;
  const pillHeight = 21;
  const pillX = Math.min(
    PLOT.width - PLOT.right - pillWidth,
    Math.max(PLOT.left, x - pillWidth / 2),
  );
  const pillY = PLOT.top + PLOT.strip + markPad + 4;
  shapes.push({
    kind: 'polyline',
    points: [
      [x, PLOT.top + PLOT.strip + markPad],
      [x, pillY],
    ],
    stroke: tokens.ink,
    width: 1.2,
  });
  shapes.push({
    kind: 'rect',
    x: pillX,
    y: pillY,
    width: pillWidth,
    height: pillHeight,
    radius: 6,
    fill: tokens.leafbg,
    stroke: typeColor,
    strokeWidth: 1.6,
  });
  shapes.push({
    kind: 'text',
    x: pillX + pillWidth / 2,
    y: pillY + 14.5,
    text: label,
    fill: tokens.ink,
    size: 11.5,
    align: 'center',
    weight: 600,
  });

  panelDefinitions(family).forEach((panel, panelIndex) => {
    const toY = panelScale(layout, panelIndex, panel.key);
    const [low, high] = layout.ranges[panel.key];
    for (const entry of panel.series) {
      const value = entry.values[hoverIndex];
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      shapes.push({
        kind: 'dot',
        x,
        y: toY(Math.min(high, Math.max(low, value))),
        radius: 3,
        fill: entry.color,
        stroke: tokens.leafbg,
        strokeWidth: 1.2,
      });
    }
  });
  return shapes;
}
