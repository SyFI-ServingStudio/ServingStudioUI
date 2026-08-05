import type { BoardJoin, BoardLanes } from './mappingBoardModel';

/**
 * §02 geometry and selection, kept out of the component.
 *
 * The board is DOM: two columns of cards laid out by flexbox, so the ribbon
 * layer cannot assume a row pitch — a long kernel name wraps differently at
 * every width. The component measures where the cards ended up and hands those
 * centres here; everything from there on is arithmetic.
 */

/** Where the curve leaves the left lane and where it straightens into the
 * right one, as fractions of the gutter. Wider than a half-and-half split so
 * the bundle reads as a ribbon rather than a diagonal. */
const BEND_OUT = 0.45;
const BEND_IN = 0.55;

export const RIBBON_IDLE_OPACITY = 0.34;
export const RIBBON_ACTIVE_OPACITY = 0.95;
export const RIBBON_IDLE_WIDTH = 1.1;
export const RIBBON_ACTIVE_WIDTH = 2;

export interface RibbonCurve {
  readonly startX: number;
  readonly startY: number;
  readonly controlOutX: number;
  readonly controlOutY: number;
  readonly controlInX: number;
  readonly controlInY: number;
  readonly endX: number;
  readonly endY: number;
  readonly color: string;
  readonly active: boolean;
}

/**
 * One curve per declared join, from the left card's right edge to the right
 * card's left edge.
 *
 * A join whose endpoints have not been measured yet is dropped rather than
 * drawn at zero, which would put a ribbon through the top-left corner on the
 * first frame.
 */
export function ribbonCurves(
  joins: readonly BoardJoin[],
  measuredCenterY: readonly (number | undefined)[],
  modelledCenterY: readonly (number | undefined)[],
  width: number,
  activeJoin: (join: BoardJoin) => boolean,
): readonly RibbonCurve[] {
  const curves: RibbonCurve[] = [];
  for (const join of joins) {
    const startY = measuredCenterY[join.measuredIndex];
    const endY = modelledCenterY[join.modelledIndex];
    if (startY === undefined || endY === undefined) continue;
    curves.push({
      startX: 0,
      startY,
      controlOutX: width * BEND_OUT,
      controlOutY: startY,
      controlInX: width * BEND_IN,
      controlInY: endY,
      endX: width,
      endY,
      color: join.color,
      active: activeJoin(join),
    });
  }
  // Active curves last so a highlighted ribbon is never buried under the
  // thirty idle ones it shares a bundle with.
  return [...curves].sort((left, right) => Number(left.active) - Number(right.active));
}

export interface BoardHighlight {
  /** Card ids drawn as selected: the ones clicked. */
  readonly selected: ReadonlySet<string>;
  /** Card ids on the far side of a ribbon from a selected card. */
  readonly joined: ReadonlySet<string>;
  readonly hasSelection: boolean;
}

/** What a selection lights up: the cards picked, and whatever the label file
 * already ties them to on the other side. */
export function boardHighlight(
  lanes: BoardLanes,
  joins: readonly BoardJoin[],
  selected: ReadonlySet<string>,
): BoardHighlight {
  const joined = new Set<string>();
  for (const join of joins) {
    const measuredId = lanes.measured[join.measuredIndex]?.id;
    const modelledId = lanes.modelled[join.modelledIndex]?.id;
    if (measuredId === undefined || modelledId === undefined) continue;
    if (selected.has(measuredId)) joined.add(modelledId);
    if (selected.has(modelledId)) joined.add(measuredId);
  }
  return { selected, joined, hasSelection: selected.size > 0 };
}

/** A ribbon is live when either of the cards it joins is selected. */
export function joinIsActive(
  lanes: BoardLanes,
  selected: ReadonlySet<string>,
): (join: BoardJoin) => boolean {
  return (join) => {
    const measuredId = lanes.measured[join.measuredIndex]?.id;
    const modelledId = lanes.modelled[join.modelledIndex]?.id;
    return (
      (measuredId !== undefined && selected.has(measuredId)) ||
      (modelledId !== undefined && selected.has(modelledId))
    );
  };
}

/** Click semantics: plain click replaces the selection and clicking the only
 * selected card clears it; a modified click adds and removes one card, which
 * is how a reader builds a selection that spans both lanes. */
export function nextSelection(
  selected: ReadonlySet<string>,
  id: string,
  additive: boolean,
): ReadonlySet<string> {
  if (additive) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    return next;
  }
  if (selected.size === 1 && selected.has(id)) return new Set<string>();
  return new Set<string>([id]);
}

/** Where the cards ended up, in the ribbon layer's own coordinates. */
export interface BoardGeometry {
  readonly measuredCenterY: readonly (number | undefined)[];
  readonly modelledCenterY: readonly (number | undefined)[];
  readonly height: number;
}

const sameCenters = (
  left: readonly (number | undefined)[],
  right: readonly (number | undefined)[],
): boolean => left.length === right.length && left.every((value, index) => value === right[index]);

/** Whether a fresh measurement changed anything. Re-measuring runs after every
 * render, so without this the state update would render again forever. */
export function sameGeometry(left: BoardGeometry, right: BoardGeometry): boolean {
  return (
    left.height === right.height &&
    sameCenters(left.measuredCenterY, right.measuredCenterY) &&
    sameCenters(left.modelledCenterY, right.modelledCenterY)
  );
}

/** Bar length as a share of the longest card on the board, so the two lanes
 * are measured against one another rather than each against itself. */
export function barWidthPct(ms: number | null, maximumMs: number): number {
  if (ms === null || !(maximumMs > 0)) return 0;
  return Math.max(0, Math.min(100, (ms / maximumMs) * 100));
}

export interface ModelledRowGapOptions {
  readonly cardHeight: number;
  readonly cardGap: number;
  readonly groupHeaderHeight: number;
}

interface OrderedAnchor {
  readonly modelledIndex: number;
  readonly target: number;
  readonly weight: number;
}

interface IsotonicBlock {
  readonly value: number;
  readonly weight: number;
  readonly start: number;
  readonly end: number;
}

/** Weighted pool-adjacent-violators fit for ordered y targets. */
function orderedAnchorFit(
  anchors: readonly OrderedAnchor[],
  lowerBound: number,
): ReadonlyMap<number, number> {
  const blocks: IsotonicBlock[] = [];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    if (anchor === undefined) continue;
    blocks.push({
      value: anchor.target,
      weight: anchor.weight,
      start: anchorIndex,
      end: anchorIndex,
    });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.value <= right.value) break;
      blocks.splice(blocks.length - 2, 2, {
        value:
          (left.value * left.weight + right.value * right.weight) / (left.weight + right.weight),
        weight: left.weight + right.weight,
        start: left.start,
        end: right.end,
      });
    }
  }

  const fitted = new Map<number, number>();
  for (const block of blocks) {
    const value = Math.max(lowerBound, block.value);
    for (let anchorIndex = block.start; anchorIndex <= block.end; anchorIndex += 1) {
      const anchor = anchors[anchorIndex];
      if (anchor !== undefined) fitted.set(anchor.modelledIndex, value);
    }
  }
  return fitted;
}

/**
 * Extra vertical gaps for the modelled lane of §02.
 *
 * The modelled cards are an ordered list, not a second list that should be
 * packed independently from the measured side. For every slot, use the mean
 * y-position of the measured cards joined to it as its visual target. Slots
 * without a direct join are translated or interpolated between neighbouring
 * targets. Finally, project the targets onto an ordered sequence with the
 * normal card separation as its minimum distance. The return value is an
 * additive gap before each card, so the DOM lane remains measurable and
 * selectable while gaining only the whitespace the alignment needs.
 */
export function modelledRowGaps(
  joins: readonly BoardJoin[],
  measuredCenterY: readonly (number | undefined)[],
  modelledCount: number,
  options: ModelledRowGapOptions,
): readonly number[] {
  if (modelledCount <= 0) return [];

  const contentTop = options.groupHeaderHeight + options.cardGap;
  const separation = options.cardHeight + options.cardGap;
  const packedCenters = Array.from(
    { length: modelledCount },
    (_unused, index) => contentTop + options.cardHeight / 2 + index * separation,
  );
  const measuredTargets = new Map<number, number[]>();
  for (const join of joins) {
    const measuredCenter = measuredCenterY[join.measuredIndex];
    if (measuredCenter === undefined) continue;
    const targets = measuredTargets.get(join.modelledIndex);
    if (targets === undefined) measuredTargets.set(join.modelledIndex, [measuredCenter]);
    else targets.push(measuredCenter);
  }
  if (measuredTargets.size === 0) return packedCenters.map(() => 0);

  // Subtract the mandatory card separation before fitting. In this coordinate
  // system, an ordered fit means the rendered centres remain at least one card
  // apart, while the objective is still the actual measured-to-modelled y
  // mismatch. A repeated join contributes repeated weight to its slot.
  const anchors: OrderedAnchor[] = [...measuredTargets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([modelledIndex, targets]) => ({
      modelledIndex,
      target:
        targets.reduce((total, measuredCenter) => total + measuredCenter, 0) / targets.length -
        modelledIndex * separation,
      weight: targets.length,
    }));
  const fittedTransformedCenters = orderedAnchorFit(anchors, packedCenters[0]);
  const linkedIndices = anchors.map((anchor) => anchor.modelledIndex);
  const desiredTransformedCenters = Array.from({ length: modelledCount }, () => packedCenters[0]);
  let previousLinkedIndex: number | undefined;
  let nextLinkedCursor = 0;
  for (let modelledIndex = 0; modelledIndex < modelledCount; modelledIndex += 1) {
    const fittedCenter = fittedTransformedCenters.get(modelledIndex);
    if (fittedCenter !== undefined) {
      desiredTransformedCenters[modelledIndex] = fittedCenter;
      previousLinkedIndex = modelledIndex;
      while (
        nextLinkedCursor < linkedIndices.length &&
        linkedIndices[nextLinkedCursor] <= modelledIndex
      ) {
        nextLinkedCursor += 1;
      }
      continue;
    }

    const nextLinkedIndex = linkedIndices[nextLinkedCursor];
    if (previousLinkedIndex === undefined && nextLinkedIndex === undefined) continue;

    if (previousLinkedIndex === undefined) {
      desiredTransformedCenters[modelledIndex] = fittedTransformedCenters.get(nextLinkedIndex!)!;
      continue;
    }
    if (nextLinkedIndex === undefined) {
      desiredTransformedCenters[modelledIndex] = fittedTransformedCenters.get(previousLinkedIndex)!;
      continue;
    }

    const fraction =
      (modelledIndex - previousLinkedIndex) / (nextLinkedIndex - previousLinkedIndex);
    desiredTransformedCenters[modelledIndex] =
      fittedTransformedCenters.get(previousLinkedIndex)! +
      fraction *
        (fittedTransformedCenters.get(nextLinkedIndex)! -
          fittedTransformedCenters.get(previousLinkedIndex)!);
  }

  const centers = desiredTransformedCenters.map(
    (transformedCenter, index) => transformedCenter + index * separation,
  );

  return centers.map((center, index) => {
    if (index === 0) return center - packedCenters[index];
    return center - centers[index - 1] - separation;
  });
}
