import type { AlignmentTimelineIterationSummary } from '../../domain/alignment';

/**
 * Ordering and lookup for a picker over every iteration in a capture.
 *
 * The index carries 2,000+ rows and the card draws one bar each, so the order
 * is a permutation of indices rather than a re-sorted copy: the selection is an
 * iteration id and must survive a change of order.
 */

export type IterationOrderKey = 'run' | 'idle';

export interface IterationOrder {
  readonly key: IterationOrderKey;
  readonly label: string;
  /** Why this order exists, shown beside the picker. */
  readonly note: string;
}

export const ITERATION_ORDERS: readonly IterationOrder[] = [
  {
    key: 'run',
    label: 'run order',
    note: 'left to right is the capture; the profile is the run’s idle over time',
  },
  {
    key: 'idle',
    label: 'idle share',
    note: 'sorted by idle fraction, so the extremes of the capture are at the ends',
  },
];

/** Indices into `iterations`, in the requested order. Ties fall back to
 * run order so the picker never reshuffles between renders. */
export function orderedIterationIndices(
  iterations: readonly AlignmentTimelineIterationSummary[],
  order: IterationOrderKey,
): readonly number[] {
  const indices = iterations.map((_, index) => index);
  if (order === 'run') return indices;
  return indices.sort(
    (left, right) => iterations[left].idleFraction - iterations[right].idleFraction || left - right,
  );
}

/**
 * The iterations the lanes draw beside the selection: whichever of its
 * immediate neighbours the capture actually recorded next to it.
 *
 * "Recorded next to it" is the id being exactly one apart, not merely adjacent
 * in the index. A capture that emitted a subset would otherwise have arbitrary
 * iterations drawn as if they were consecutive, and the wall clock between them
 * — the whole reason three are on one axis — would be a fiction.
 */
export function neighbourIterationIds(
  iterations: readonly AlignmentTimelineIterationSummary[],
  selectedIterationId: number | null,
): { readonly before: number | null; readonly after: number | null } {
  const index = iterations.findIndex((row) => row.iterationId === selectedIterationId);
  if (index < 0) return { before: null, after: null };
  const selected = iterations[index].iterationId;
  const at = (offset: number): number | null => {
    const row = iterations[index + offset];
    return row !== undefined && row.iterationId === selected + offset ? row.iterationId : null;
  };
  return { before: at(-1), after: at(1) };
}

/** Step the selection through the current order, clamped at both ends. A step
 * past the end is the end, not a wrap: the picker is a ruler, not a carousel. */
export function stepSelection(
  ordered: readonly number[],
  iterations: readonly AlignmentTimelineIterationSummary[],
  selectedIterationId: number,
  delta: number,
): number {
  if (ordered.length === 0) return selectedIterationId;
  const currentSlot = ordered.findIndex(
    (index) => iterations[index].iterationId === selectedIterationId,
  );
  const slot = Math.max(
    0,
    Math.min(ordered.length - 1, (currentSlot < 0 ? 0 : currentSlot) + delta),
  );
  return iterations[ordered[slot]].iterationId;
}

/** The iteration a bar at `slot` selects. */
export function iterationAtSlot(
  ordered: readonly number[],
  iterations: readonly AlignmentTimelineIterationSummary[],
  slot: number,
): AlignmentTimelineIterationSummary | null {
  const index = ordered[Math.max(0, Math.min(ordered.length - 1, slot))];
  return index === undefined ? null : iterations[index];
}

/** The iterations the analyzer distinguished, in index order. `full_capture`
 * means "no reason beyond being in the capture" and is not a distinction. */
export function distinguishedIterations(
  iterations: readonly AlignmentTimelineIterationSummary[],
): readonly AlignmentTimelineIterationSummary[] {
  return iterations.filter((row) => row.selectedAs !== 'full_capture');
}

export function findIteration(
  iterations: readonly AlignmentTimelineIterationSummary[],
  iterationId: number | null,
): AlignmentTimelineIterationSummary | null {
  if (iterationId === null) return null;
  return iterations.find((row) => row.iterationId === iterationId) ?? null;
}

/** The iteration a page opens on: the middle row of the real capture. A
 * middle run position is a better timing-predict example than the first
 * distinguished row, which is often an edge or an analyzer-selected outlier.
 * The choice is deterministic and a later user click remains untouched. */
export function defaultIterationId(
  iterations: readonly AlignmentTimelineIterationSummary[],
): number | null {
  if (iterations.length === 0) return null;
  return iterations[Math.floor(iterations.length / 2)].iterationId;
}

/** Choose from the timeline index before a board-only representative. The
 * timeline list is the page-wide selectable set and, for static exports, the
 * exact set whose detail shards were bundled. */
export function initialAlignmentIterationId(
  timelineIterations: readonly AlignmentTimelineIterationSummary[],
  boardExampleIterationId: number | null,
): number | null {
  return defaultIterationId(timelineIterations) ?? boardExampleIterationId;
}
