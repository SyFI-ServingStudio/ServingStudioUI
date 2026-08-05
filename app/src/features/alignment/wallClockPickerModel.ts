import type { AlignmentTimelineIterationSummary } from '../../domain/alignment';

/**
 * Geometry for a picker with one bar per iteration in the capture.
 *
 * At 2,000 bars any per-bar text a picker could afford would be unreadable and
 * slow to lay out, so a bar carries exactly two channels — height is the idle
 * share of its span, colour is its iteration type — and the selection is named
 * above its own bar. Everything below is pure so the bar under a click is
 * decided by the same arithmetic that drew it, rather than by hit-testing 2,000
 * DOM nodes.
 */

export const PICKER = {
  /** The scale sits outside the scroller, so it stays readable at any offset. */
  axisWidth: 52,
  /** Slack past the last bar, so the final bar is not flush with the edge. */
  trailingWidth: 14,
  top: 16,
  barsHeight: 76,
  height: 126,
  pitch: 6,
  barWidth: 4,
} as const;

/** Headroom above the tallest bar, so the selection marker around it has
 * somewhere to go and the caption above it is not clipped. */
const HEADROOM = 1.12;

export function pickerWidth(count: number): number {
  return PICKER.trailingWidth + count * PICKER.pitch;
}

/** The idle fraction the top of the plot represents. */
export function pickerTopFraction(
  iterations: readonly AlignmentTimelineIterationSummary[],
): number {
  const tallest = iterations.reduce((high, row) => Math.max(high, row.idleFraction), 0);
  return tallest > 0 ? tallest * HEADROOM : 1;
}

/** Which fractions get a gridline and a label. Quarters, dropped where they
 * fall off the top: a labelled tick above every bar would be a scale for a
 * plot that is not there. */
export function pickerTicks(topFraction: number): readonly number[] {
  return [0.25, 0.5, 0.75].filter((value) => value < topFraction);
}

export interface PickerBar {
  /** Index into the unordered `iterations` array, so a bar means the same
   * iteration whichever way the picker is sorted. */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly iterationId: number;
  readonly iterationType: string;
  readonly selected: boolean;
}

export function pickerBars(
  iterations: readonly AlignmentTimelineIterationSummary[],
  ordered: readonly number[],
  topFraction: number,
  selectedIterationId: number | null,
): readonly PickerBar[] {
  const bottom = PICKER.top + PICKER.barsHeight;
  return ordered.map((index, slot) => {
    const row = iterations[index];
    const y = bottom - (row.idleFraction / topFraction) * PICKER.barsHeight;
    return {
      index,
      x: slot * PICKER.pitch,
      y,
      height: Math.max(0.6, bottom - y),
      iterationId: row.iterationId,
      iterationType: row.iterationType,
      selected: row.iterationId === selectedIterationId,
    };
  });
}

export function pickerFractionY(fraction: number, topFraction: number): number {
  return PICKER.top + PICKER.barsHeight - (fraction / topFraction) * PICKER.barsHeight;
}

/** An iteration id every `n` bars: enough to know where you are, sparse enough
 * to read. Derived from the drawn width so the ruler does not thin out when the
 * capture is short. */
export function pickerRulerStep(count: number, width: number): number {
  return Math.max(1, Math.round(count / Math.max(6, Math.floor(width / 150))));
}

/** The slot a click at `offsetPx` lands on, clamped into the plot. */
export function pickerSlotAt(offsetPx: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.floor(offsetPx / PICKER.pitch)));
}

/** How far to scroll so the selection is centred, clamped at both ends. */
export function pickerScrollLeft(
  selectedSlot: number,
  viewportWidth: number,
  count: number,
): number {
  const maximum = Math.max(0, pickerWidth(count) - viewportWidth);
  return Math.max(0, Math.min(maximum, selectedSlot * PICKER.pitch - viewportWidth / 2));
}

/** Where the selection's caption anchors: at the ends it would otherwise be cut
 * off by the scroller, so it turns to face inwards. */
export function pickerCaptionAlign(selectedSlot: number, count: number): CanvasTextAlign {
  if (selectedSlot < 6) return 'left';
  if (selectedSlot > count - 6) return 'right';
  return 'center';
}
