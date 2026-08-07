import type { AlignmentOperationStats, AlignmentPairedIteration } from '../../domain/alignment';
import type { OperationSplitCycle } from './operationSplitCycles';
import type { OperationPalette } from './operationSplitPalette';
import { shortOperationName } from './operationSplitPalette';

/**
 * §03 — one cycle, split by operation.
 *
 * A point in §01 is one cycle reduced to one number. Everything here opens
 * that number up: the measured kernels and the modelled slots of one chosen
 * cycle as two stacks on a shared millisecond axis, the joins between them,
 * and where their difference accumulates across the cycle.
 *
 * The whole module is arithmetic and geometry over plain numbers. The canvas
 * that paints it and the card that lays it out hold neither, so a coordinate
 * or a running total can be asserted directly instead of being read back out
 * of a bitmap.
 *
 * Geometry is expressed in one fixed design space and scaled to whatever width
 * the card gets. Two stacks that must be measured against each other by eye
 * need their proportions — lane height against gutter against ruler — to hold
 * at every width, and a layout recomputed per breakpoint does not give that.
 */

// ---- which cycles the picker offers ---------------------------------------

export interface CycleChoice {
  readonly iterationId: number;
  /** Where the cycle sits among the capture's paired iterations. One document
   * layout addresses a cycle by this position rather than by its id. */
  readonly positionInCapture: number;
  readonly stage: string;
  readonly relativeDiffPct: number;
}

/** How many of the capture's off-stage cycles the sample opens with. */
const OFF_STAGE_SAMPLES = 3;

function dominantStage(iterations: readonly AlignmentPairedIteration[]): string | null {
  const counts = new Map<string, number>();
  for (const iteration of iterations) {
    counts.set(iteration.stage, (counts.get(iteration.stage) ?? 0) + 1);
  }
  let dominant: string | null = null;
  let best = -1;
  for (const [stage, count] of counts) {
    if (count > best) {
      dominant = stage;
      best = count;
    }
  }
  return dominant;
}

function cycleChoice(iteration: AlignmentPairedIteration, position: number): CycleChoice {
  return {
    iterationId: iteration.iterationId,
    positionInCapture: position,
    stage: iteration.stage,
    relativeDiffPct: iteration.relativeDiffPct,
  };
}

/**
 * The cycles offered for inspection, out of every paired iteration.
 *
 * Two rules, because either alone misses half of a capture. A serving run is
 * one stage almost throughout, and the cycles that are not — the opening
 * prefill and mixed ones — sit at its head, so an even spread would offer none
 * of them. The spread is what keeps the rest of the run reachable. Together
 * they stay inside a bar count that can still be aimed at with a pointer.
 */
export function selectableCycles(
  iterations: readonly AlignmentPairedIteration[],
  sampleSize: number,
  selectedIterationId: number | null = null,
): readonly CycleChoice[] {
  if (iterations.length === 0 || sampleSize <= 0) return [];
  if (iterations.length <= sampleSize) {
    return iterations.map((iteration, position) => cycleChoice(iteration, position));
  }
  const stage = dominantStage(iterations);
  const picked = new Set<number>();
  const selectedPosition = iterations.findIndex(
    (iteration) => iteration.iterationId === selectedIterationId,
  );
  if (selectedPosition >= 0) picked.add(selectedPosition);
  for (const [index, iteration] of iterations.entries()) {
    if (picked.size >= OFF_STAGE_SAMPLES) break;
    if (iteration.stage !== stage) picked.add(index);
  }
  const spread = sampleSize - picked.size;
  const last = iterations.length - 1;
  if (spread > 0) {
    for (let step = 1; step <= spread; step += 1) {
      picked.add(Math.round((step * last) / spread));
    }
  }
  return [...picked]
    .sort((left, right) => left - right)
    .map((index) => cycleChoice(iterations[index], index));
}

/** Where the arrow, home and end keys move the picker from `index`. */
export function steppedCycleIndex(index: number, count: number, key: string): number | null {
  const moves: Readonly<Record<string, number>> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    Home: -count,
    End: count,
  };
  const move = moves[key];
  if (move === undefined || count === 0) return null;
  return Math.min(count - 1, Math.max(0, index + move));
}

// ---- the two stacks of one cycle ------------------------------------------

export interface MeasuredGroup {
  /** `M5` — the handle the segment label and the tooltip share. */
  readonly id: string;
  readonly phase: string;
  readonly operation: string | null;
  /** The group's kernel where it folded by kernel name, and the first
   * occurrence's kernel where it folded by operation — a mapped group is many
   * distinct kernels and names none of them. */
  readonly kernelName: string;
  readonly launches: number;
  readonly foldedRows: number;
  readonly ms: number;
}

export interface SimulatedSlotRow {
  readonly id: string;
  readonly slotIndex: number;
  readonly name: string;
  readonly kind: string;
  readonly operation: string | null;
  readonly multiplicity: number;
  readonly ms: number;
}

/**
 * The cycle's measured kernels folded to one group per repeated position.
 *
 * A cycle is several hundred kernel occurrences against a few dozen modelled
 * slots, because the program runs one layer body dozens of times; drawn one
 * segment per occurrence the measured lane is a stripe pattern no ribbon can
 * land on and no label can name. The fold is what makes a repeated layer body
 * read as the operations it is made of.
 *
 * Mapped kernels fold by operation, which is the only fold that keeps the lane
 * joinable to the modelled one — the operation is the join, and the modelled
 * lane is already folded the same way by the cost tree's own repeat nodes.
 * Kernels the labeler tied to nothing fold by kernel name instead, so the
 * unmapped time a reader is looking for arrives as one segment per distinct
 * kernel rather than as dozens of slivers.
 *
 * Both keys carry the phase, and groups keep the order of their first
 * occurrence, so the lane still runs in the order the cycle did even though a
 * group's width is now that operation's whole time.
 */
export function foldMeasuredGroups(
  kernels: OperationSplitCycle['measuredKernels'],
): readonly MeasuredGroup[] {
  const byKey = new Map<string, MeasuredGroup>();
  const order: string[] = [];
  for (const kernel of kernels) {
    const key = JSON.stringify(
      kernel.operation === null
        ? [kernel.phase, 'kernel', kernel.name]
        : [kernel.phase, 'operation', kernel.operation],
    );
    const seen = byKey.get(key);
    if (seen === undefined) {
      order.push(key);
      byKey.set(key, {
        id: `M${order.length}`,
        phase: kernel.phase,
        operation: kernel.operation,
        kernelName: kernel.name,
        launches: kernel.calls,
        foldedRows: 1,
        ms: kernel.durationMs,
      });
      continue;
    }
    byKey.set(key, {
      ...seen,
      launches: seen.launches + kernel.calls,
      foldedRows: seen.foldedRows + 1,
      ms: seen.ms + kernel.durationMs,
    });
  }
  return order.map((key) => byKey.get(key) as MeasuredGroup);
}

/** The modelled leaves in slot order, which is the order the cost tree
 * evaluates them and therefore the order of the lane. */
export function simulatedSlotRows(
  slots: OperationSplitCycle['simulatedSlots'],
): readonly SimulatedSlotRow[] {
  // The producer's folded_ms is the value represented by the cycle's
  // simulated_leaf_workload_ms total. Zero-work leaves carry structure but no
  // visible width, so omit only those.
  return slots
    .filter((slot) => slot.criticalPathMs > 1e-12)
    .map((slot, index) => ({
      id: `S${index + 1}`,
      slotIndex: slot.slotIndex,
      name: slot.name,
      kind: slot.kind,
      operation: slot.operation,
      multiplicity: slot.multiplicity,
      ms: slot.criticalPathMs,
    }));
}

export interface PhaseSpan {
  readonly phase: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** Runs of one phase over the measured lane. The lane is never split by them:
 * a phase boundary falling inside a folded group would be a boundary the fold
 * cannot honour, so phases are annotation above the stack rather than
 * structure in it. */
export function phaseSpans(groups: readonly MeasuredGroup[]): readonly PhaseSpan[] {
  const spans: PhaseSpan[] = [];
  let cursor = 0;
  for (const group of groups) {
    const last = spans.at(-1);
    if (last !== undefined && last.phase === group.phase) {
      spans[spans.length - 1] = { ...last, endMs: cursor + group.ms };
    } else {
      spans.push({ phase: group.phase, startMs: cursor, endMs: cursor + group.ms });
    }
    cursor += group.ms;
  }
  return spans;
}

export interface CumulativeError {
  /** Measured time the modelled side never accounts for, which the curve owes
   * from its first point rather than acquiring along the way. */
  readonly baselineMs: number;
  /** `slots.length + 1` boundaries along the modelled lane. */
  readonly edgesMs: readonly number[];
  /** The running difference after each slot. */
  readonly levelsMs: readonly number[];
}

/**
 * Where the cycle's difference accumulates, walked along the modelled lane.
 *
 * The two lanes have different shapes — one operation is one measured group
 * and often several modelled slots — so the measured time an operation owns is
 * apportioned across that operation's slots in proportion to slot width. It is
 * the only split available that invents nothing: the slots are the finest
 * subdivision either side agrees on, and any other weighting would be this
 * page deciding which slot an error belongs to.
 *
 * Measured time with no modelled counterpart cannot be apportioned at all, so
 * it opens the curve as a debt instead. That keeps the last level exactly
 * equal to the cycle's total difference, which is the number printed beside
 * it.
 */
export function cumulativeErrorSteps(
  groups: readonly MeasuredGroup[],
  slots: readonly SimulatedSlotRow[],
): CumulativeError {
  const measuredByOperation = new Map<string, number>();
  const simulatedByOperation = new Map<string, number>();
  let unmatchedMs = 0;
  for (const group of groups) {
    if (group.operation === null) unmatchedMs += group.ms;
    else {
      measuredByOperation.set(
        group.operation,
        (measuredByOperation.get(group.operation) ?? 0) + group.ms,
      );
    }
  }
  for (const slot of slots) {
    if (slot.operation !== null) {
      simulatedByOperation.set(
        slot.operation,
        (simulatedByOperation.get(slot.operation) ?? 0) + slot.ms,
      );
    }
  }
  for (const [operation, ms] of measuredByOperation) {
    if (!((simulatedByOperation.get(operation) ?? 0) > 0)) unmatchedMs += ms;
  }
  const edgesMs = [0];
  const levelsMs: number[] = [];
  let running = -unmatchedMs;
  for (const slot of slots) {
    const owned = slot.operation === null ? 0 : (simulatedByOperation.get(slot.operation) ?? 0);
    const share =
      owned > 0 && slot.operation !== null
        ? ((measuredByOperation.get(slot.operation) ?? 0) * slot.ms) / owned
        : 0;
    running += slot.ms - share;
    edgesMs.push(edgesMs[edgesMs.length - 1] + slot.ms);
    levelsMs.push(running);
  }
  return { baselineMs: -unmatchedMs, edgesMs, levelsMs };
}

// ---- the plot's geometry --------------------------------------------------

/**
 * The plot's design space, in the proportions of the study this section came
 * from. The card scales the whole space to its width rather than reflowing it.
 */
export const SPLIT_PLOT = {
  width: 1180,
  height: 352,
  gutter: 126,
  right: 64,
  phaseY: 26,
  measuredY: 36,
  laneHeight: 42,
  simulatedY: 132,
  rulerY: 192,
  stepY: 224,
  stepHeight: 100,
  /** Below this share of its lane a segment gets no label, and below twice it
   * only its handle: the alternative is text wider than the box it names. */
  labelShare: 0.055,
  detailShare: 0.11,
  tickCount: 9,
} as const;

export interface AxisTick {
  readonly value: number;
  readonly x: number;
}

export interface StackSegment {
  readonly id: string;
  readonly index: number;
  readonly x: number;
  readonly width: number;
  readonly y: number;
  readonly height: number;
  readonly centerX: number;
  readonly ms: number;
  readonly operation: string | null;
  /** No label, the handle alone, or the handle with its duration. */
  readonly label: 'none' | 'handle' | 'detail';
}

export interface Ribbon {
  readonly fromX: number;
  readonly toX: number;
  readonly topY: number;
  readonly bottomY: number;
  readonly operation: string;
}

export interface PhaseMark {
  readonly phase: string;
  readonly centerX: number;
  readonly ruleX: number | null;
  readonly labelled: boolean;
}

export interface CumulativeBand {
  readonly x: number;
  readonly width: number;
  readonly operation: string | null;
}

export interface CumulativeGeometry {
  readonly bands: readonly CumulativeBand[];
  readonly zeroY: number;
  readonly path: readonly (readonly [number, number])[];
  readonly dots: readonly (readonly [number, number])[];
  readonly lowMs: number;
  readonly lowY: number;
  readonly endX: number;
  readonly endY: number;
  readonly totalDeltaMs: number;
}

export interface PlotGeometry {
  readonly domainMs: number;
  readonly ticks: readonly AxisTick[];
  readonly measured: readonly StackSegment[];
  readonly simulated: readonly StackSegment[];
  readonly phaseMarks: readonly PhaseMark[];
  readonly ribbons: readonly Ribbon[];
  readonly cumulative: CumulativeGeometry;
}

/** Round axis values, roughly `count` of them, over `[low, high]`. */
export function niceTicks(low: number, high: number, count: number): readonly number[] {
  const span = high - low;
  if (!(span > 0)) return [low];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks;
}

const MINIMUM_SEGMENT_WIDTH = 0.8;
/** A hair of headroom past the longer stack, so its last segment's edge stays
 * distinguishable from the end of the axis. */
const DOMAIN_HEADROOM = 1.03;

function labelFor(share: number): StackSegment['label'] {
  if (share >= SPLIT_PLOT.detailShare) return 'detail';
  if (share >= SPLIT_PLOT.labelShare) return 'handle';
  return 'none';
}

interface StackRow {
  readonly id: string;
  readonly operation: string | null;
  readonly ms: number;
}

function layStack(
  rows: readonly StackRow[],
  laneTotalMs: number,
  y: number,
  toX: (ms: number) => number,
): readonly StackSegment[] {
  let cursorMs = 0;
  return rows.map((row, index) => {
    const x = toX(cursorMs);
    const width = Math.max(MINIMUM_SEGMENT_WIDTH, toX(cursorMs + row.ms) - x);
    cursorMs += row.ms;
    return {
      id: row.id,
      index,
      x,
      width,
      y,
      height: SPLIT_PLOT.laneHeight,
      centerX: x + width / 2,
      ms: row.ms,
      operation: row.operation,
      label: labelFor(laneTotalMs > 0 ? row.ms / laneTotalMs : 0),
    };
  });
}

/**
 * The joins between the lanes.
 *
 * The only sound join is the operation string, and one measured group may own
 * several modelled slots, so a join is a fan rather than a line. Drawing it as
 * one line each would claim a correspondence between a group and a slot that
 * the label file does not make.
 */
function ribbonsBetween(
  measured: readonly StackSegment[],
  simulated: readonly StackSegment[],
): readonly Ribbon[] {
  const targets = new Map<string, number[]>();
  for (const segment of simulated) {
    if (segment.operation === null) continue;
    const list = targets.get(segment.operation) ?? [];
    list.push(segment.centerX);
    targets.set(segment.operation, list);
  }
  const topY = SPLIT_PLOT.measuredY + SPLIT_PLOT.laneHeight;
  const bottomY = SPLIT_PLOT.simulatedY;
  const ribbons: Ribbon[] = [];
  for (const segment of measured) {
    if (segment.operation === null) continue;
    for (const toX of targets.get(segment.operation) ?? []) {
      ribbons.push({ fromX: segment.centerX, toX, topY, bottomY, operation: segment.operation });
    }
  }
  return ribbons;
}

export function plotGeometry(
  groups: readonly MeasuredGroup[],
  slots: readonly SimulatedSlotRow[],
  measuredTotalMs: number,
  simulatedTotalMs: number,
): PlotGeometry {
  const plotWidth = SPLIT_PLOT.width - SPLIT_PLOT.gutter - SPLIT_PLOT.right;
  const domainMs = Math.max(measuredTotalMs, simulatedTotalMs, Number.MIN_VALUE) * DOMAIN_HEADROOM;
  const toX = (ms: number): number => SPLIT_PLOT.gutter + (ms / domainMs) * plotWidth;

  const measured = layStack(groups, measuredTotalMs, SPLIT_PLOT.measuredY, toX);
  const simulated = layStack(slots, simulatedTotalMs, SPLIT_PLOT.simulatedY, toX);

  const phaseMarks = phaseSpans(groups).map((span, index) => ({
    phase: span.phase,
    centerX: toX((span.startMs + span.endMs) / 2),
    ruleX: index === 0 ? null : toX(span.startMs),
    labelled: span.endMs - span.startMs > domainMs * SPLIT_PLOT.labelShare,
  }));

  const { baselineMs, edgesMs, levelsMs } = cumulativeErrorSteps(groups, slots);
  const values = [baselineMs, ...levelsMs, 0];
  const lowMs = Math.min(...values);
  const highMs = Math.max(...values);
  const pad = (highMs - lowMs || 1) * 0.16;
  const toStepY = (ms: number): number =>
    SPLIT_PLOT.stepY +
    SPLIT_PLOT.stepHeight -
    ((ms - lowMs + pad) / (highMs - lowMs + pad * 2)) * SPLIT_PLOT.stepHeight;

  // The curve holds each level across the slot that produced it, so a step can
  // be put against the segment above it rather than against a slope.
  const levelsBefore = [baselineMs, ...levelsMs.slice(0, -1)];
  const path: (readonly [number, number])[] = [];
  levelsBefore.forEach((level, index) => {
    path.push([toX(edgesMs[index]), toStepY(level)]);
    path.push([toX(edgesMs[index + 1]), toStepY(level)]);
  });
  const lastLevel = levelsMs.at(-1) ?? baselineMs;
  const endX = toX(edgesMs[edgesMs.length - 1]);
  path.push([endX, toStepY(lastLevel)]);

  return {
    domainMs,
    ticks: niceTicks(0, domainMs, SPLIT_PLOT.tickCount).map((value) => ({ value, x: toX(value) })),
    measured,
    simulated,
    phaseMarks,
    ribbons: ribbonsBetween(measured, simulated),
    cumulative: {
      bands: slots.map((slot, index) => {
        const x = toX(edgesMs[index]);
        return {
          x,
          width: Math.max(MINIMUM_SEGMENT_WIDTH, toX(edgesMs[index + 1]) - x),
          operation: slot.operation,
        };
      }),
      zeroY: toStepY(0),
      path,
      dots: levelsMs.map((level, index) => [toX(edgesMs[index + 1]), toStepY(level)] as const),
      lowMs,
      lowY: toStepY(lowMs),
      endX,
      endY: toStepY(lastLevel),
      totalDeltaMs: simulatedTotalMs - measuredTotalMs,
    },
  };
}

// ---- the cycle picker's geometry ------------------------------------------

export const CYCLE_PICKER = {
  width: 1180,
  height: 58,
  inset: 10,
  /** Every seventh cycle carries its number: more collide at this width, fewer
   * leaves the run without landmarks. */
  tickEvery: 7,
} as const;

export interface PickerBar {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly overpredicted: boolean;
  readonly ticked: boolean;
  readonly labelX: number;
}

export interface PickerGeometry {
  readonly zeroY: number;
  readonly labelY: number;
  readonly frameHeight: number;
  readonly bars: readonly PickerBar[];
}

const MINIMUM_BAR_WIDTH = 3.5;
const BAR_GAP = 3.4;
const MINIMUM_BAR_HEIGHT = 1.4;
/** Headroom above the loudest cycle, so its bar stops short of the frame. */
const PICKER_HEADROOM = 1.15;

export function pickerGeometry(
  cycles: readonly CycleChoice[],
  selectedIndex: number,
): PickerGeometry {
  const plotWidth = CYCLE_PICKER.width - CYCLE_PICKER.inset * 2;
  const zeroY = CYCLE_PICKER.height * 0.62;
  const reach = CYCLE_PICKER.height * 0.44;
  const domain =
    Math.max(...cycles.map((cycle) => Math.abs(cycle.relativeDiffPct)), Number.MIN_VALUE) *
    PICKER_HEADROOM;
  const step = cycles.length === 0 ? plotWidth : plotWidth / cycles.length;
  const barWidth = Math.max(MINIMUM_BAR_WIDTH, step - BAR_GAP);
  const toY = (value: number): number => zeroY - (value / domain) * reach;
  return {
    zeroY,
    labelY: CYCLE_PICKER.height - 2,
    frameHeight: CYCLE_PICKER.height - 13,
    bars: cycles.map((cycle, index) => {
      const x = CYCLE_PICKER.inset + index * step + (step - barWidth) / 2;
      const y = toY(cycle.relativeDiffPct);
      return {
        index,
        x,
        y: Math.min(zeroY, y),
        width: barWidth,
        height: Math.max(MINIMUM_BAR_HEIGHT, Math.abs(y - zeroY)),
        overpredicted: cycle.relativeDiffPct >= 0,
        ticked: index % CYCLE_PICKER.tickEvery === 0 || index === selectedIndex,
        labelX: x + barWidth / 2,
      };
    }),
  };
}

// ---- the operation rail ---------------------------------------------------

export type OperationSortKey = 'delta' | 'relative' | 'measured';
export type OperationScope = 'cycle' | 'run';

export interface OperationRow {
  readonly operation: string;
  readonly shortName: string;
  readonly color: string;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  /** For a cycle this is the difference itself; over a run it is the mean
   * difference summed across every pairing, which is what the run's total
   * error is actually made of. */
  readonly deltaMs: number;
  readonly relativeDiffPct: number;
  /** How many pairings the row stands for, or null for a single cycle. */
  readonly pairings: number | null;
}

/** One chosen cycle, from its own per-operation summary. */
export function cycleOperationRows(
  cycle: OperationSplitCycle,
  palette: OperationPalette,
): readonly OperationRow[] {
  return cycle.operationSummary.map((row) => ({
    operation: row.operation,
    shortName: shortOperationName(row.operation),
    color: palette.colorOf(row.operation),
    measuredMs: row.measuredMs,
    simulatedMs: row.simulatedMs,
    deltaMs: row.deltaMs,
    relativeDiffPct: row.relativeDiffPct,
    pairings: null,
  }));
}

/**
 * The whole run, from the report's per-operation statistics.
 *
 * The means are used rather than the medians, and a row's weight is the mean
 * difference times the number of pairings. That product is the operation's
 * actual contribution to the run's total error; a median would describe a
 * typical cycle instead, and typical cycles do not add up to the total.
 */
export function runOperationRows(
  operations: readonly AlignmentOperationStats[],
  palette: OperationPalette,
): readonly OperationRow[] {
  return operations.map((row) => ({
    operation: row.operation,
    shortName: shortOperationName(row.operation),
    color: palette.colorOf(row.operation),
    measuredMs: row.measuredMs.mean,
    simulatedMs: row.simulatedMs.mean,
    deltaMs: row.nPaired * (row.simulatedMs.mean - row.measuredMs.mean),
    relativeDiffPct: row.relativeDiffPct.mean,
    pairings: row.nPaired,
  }));
}

export function sortOperationRows(
  rows: readonly OperationRow[],
  key: OperationSortKey,
): readonly OperationRow[] {
  const weight = (row: OperationRow): number => {
    if (key === 'relative') return Math.abs(row.relativeDiffPct);
    if (key === 'measured') return row.measuredMs;
    return Math.abs(row.deltaMs);
  };
  return [...rows].sort(
    (left, right) => weight(right) - weight(left) || left.operation.localeCompare(right.operation),
  );
}

/** Headroom past the widest row, so the longest bar stops short of its end. */
const RAIL_HEADROOM = 1.05;

export interface DivergingBar {
  /** Percentages of the row's track, measured from its left edge. */
  readonly leftPct: number;
  readonly widthPct: number;
  readonly overpredicted: boolean;
}

/** One diverging bar per row, all on one scale so the rows are comparable by
 * length, with zero in the middle so over- and underprediction separate
 * without the sign having to be read. */
export function divergingBars(rows: readonly OperationRow[]): readonly DivergingBar[] {
  const domain =
    Math.max(...rows.map((row) => Math.abs(row.deltaMs)), Number.MIN_VALUE) * RAIL_HEADROOM;
  return rows.map((row) => {
    const halfWidth = (Math.abs(row.deltaMs) / domain) * 50;
    const overpredicted = row.deltaMs >= 0;
    return { leftPct: overpredicted ? 50 : 50 - halfWidth, widthPct: halfWidth, overpredicted };
  });
}
