import type {
  AlignmentBreakdown,
  AlignmentIterationReport,
  AlignmentKernelRow,
  AlignmentSequence,
  AlignmentSequences,
} from '../../domain/alignment';
import { GROUP } from '../../domain/cost-tree';
import { measuredKernelFamily } from './kernelFamily';
import { rotatingOperationColors } from './operationSplitPalette';

/**
 * §02 — what is in the comparison, and what is not.
 *
 * Every pair in §01 is a sum over kernels a label file tied to a modelled
 * slot. This turns that label file into a board: the measured program on the
 * left in the order it ran, the modelled slots on the right, and a ribbon
 * wherever the two are joined.
 *
 * Both lanes describe ONE call of the thing they name. The measured side uses
 * the analyzer row's mean_call_us, and the modelled side uses one timing-
 * predict leaf's unit_ms. A repeated block keeps its ×n count beside the
 * card; it never multiplies the displayed call latency.
 *
 * The program stays folded. The labeler emitted a repeated block around a
 * layer body, and expanding it would turn a 25-row board into a 451-row one
 * that says the same thing 32 times. The card shows one call and keeps the
 * repeat count beside it.
 */

/** The picker offers the costliest programs of each phase and reports what it
 * left out rather than hiding it. A capture has ~90 distinct programs and all
 * but a handful are single-iteration variants of one of the offered ones. */
export const SEQUENCES_OFFERED_PER_PHASE = 10;

export const UNMAPPED_KERNEL_LABEL = 'no modelled slot';
export const UNCLAIMED_SLOT_LABEL = 'no measured kernel';

export interface BoardKernelCard {
  /** Selection key, unique across both lanes. */
  readonly id: string;
  readonly name: string;
  /** The operation the labeler tied this position to, or the words that say it
   * tied it to nothing. */
  readonly operationLabel: string;
  readonly mapped: boolean;
  readonly color: string;
  /** Rank-combined latency of one call of this kernel, in milliseconds. */
  readonly ms: number | null;
  readonly timingNote: string;
  readonly repeat: number | null;
  readonly simulatedSlots: readonly string[];
  readonly phase: string;
}

export interface BoardSlotCard {
  readonly id: string;
  readonly slot: string;
  readonly operationLabel: string;
  readonly claimed: boolean;
  readonly color: string;
  /** Timing-predict unit_ms for one call in the selected example iteration. */
  readonly ms: number | null;
  readonly timingNote: string;
  /** Shared multiplicity when every folded leaf agrees; null when they do not. */
  readonly repeat: number | null;
}

/** A run of cards under one heading: the phase on the measured side, the whole
 * modelled lane on the other. */
export interface BoardGroup {
  readonly label: string;
  readonly note: string;
  readonly from: number;
  readonly to: number;
}

/** One selectable program of one phase. */
export interface BoardSequenceOption {
  readonly key: string;
  readonly phase: string;
  readonly sequenceId: string;
  /** The identifier as the board shows it: the analyzer's `sequence_` prefix
   * dropped and the digest truncated, which is still unique within a phase. */
  readonly shortId: string;
  readonly iterations: number;
  /** Middle occurrence used when the reader chooses this program. */
  readonly representativeIterationId: number | null;
  readonly expandedKernelCount: number;
  /** Whole-capture cost of every position of this program. */
  readonly runMs: number;
}

export interface BoardSequenceCatalog {
  readonly phaseOrder: readonly string[];
  readonly phaseMs: Readonly<Record<string, number>>;
  /** Every program. The UI bounds the browse list, never the identity lookup. */
  readonly all: readonly BoardSequenceOption[];
  readonly offered: readonly BoardSequenceOption[];
  readonly omittedSequences: number;
  readonly omittedMs: number;
}

export interface BoardLanes {
  readonly measured: readonly BoardKernelCard[];
  readonly measuredGroups: readonly BoardGroup[];
  readonly modelled: readonly BoardSlotCard[];
  readonly modelledGroups: readonly BoardGroup[];
  /** Longest single-call bar on the board, so both lanes share one scale. */
  readonly maximumMs: number;
}

export interface BoardJoin {
  readonly measuredIndex: number;
  readonly modelledIndex: number;
  readonly color: string;
}

const shortSequenceId = (sequenceId: string): string =>
  sequenceId.replace('sequence_', '').slice(0, 8);

const familyColor = (category: string, operationType: string | null): string =>
  GROUP[measuredKernelFamily(category, operationType)].color;

/** Program positions are keyed `sequence_id:expanded_ordinal`. The fold means
 * one board row stands for `repeat` of them, laid out body after body, so the
 * ordinals a card covers are `ordinal + turn * bodyLength + offset`. */
function positionRunMs(
  sequence: AlignmentSequence,
  costByRowId: ReadonlyMap<string, AlignmentKernelRow>,
  firstOrdinal: number,
  bodyLength: number,
  repeat: number,
  offset: number,
): number {
  let total = 0;
  for (let turn = 0; turn < repeat; turn += 1) {
    const row = costByRowId.get(
      `${sequence.sequenceId}:${firstOrdinal + turn * bodyLength + offset}`,
    );
    if (row !== undefined) total += row.totalMs;
  }
  return total;
}

/** Mean measured latency of one call for a repeated program position. */
/**
 * One selected iteration's measured call latency for a folded position.
 *
 * The analyzer's iteration detail has already combined the participating
 * ranks into each `duration_ms`. `calls` is the number of rank launches, not a
 * multiplier to apply to that duration. A folded board row covers several
 * expanded row ids, so return their mean call duration; this averages across
 * repeated layer positions, never across ranks.
 */
function exampleMeasuredUnitMs(
  sequence: AlignmentSequence,
  durationByRowId: ReadonlyMap<string, number>,
  firstOrdinal: number,
  bodyLength: number,
  repeat: number,
  offset: number,
): { readonly ms: number; readonly samples: number } | null {
  const durations: number[] = [];
  for (let turn = 0; turn < repeat; turn += 1) {
    const rowId = `${sequence.sequenceId}:${firstOrdinal + turn * bodyLength + offset}`;
    const durationMs = durationByRowId.get(rowId);
    if (durationMs !== undefined) durations.push(durationMs);
  }
  if (durations.length === 0) return null;
  return {
    ms: durations.reduce((total, durationMs) => total + durationMs, 0) / durations.length,
    samples: durations.length,
  };
}

/** Whole-capture cost of every position of one program, folded. */
function programCost(
  sequence: AlignmentSequence,
  costByRowId: ReadonlyMap<string, AlignmentKernelRow>,
): { readonly positions: readonly { readonly runMs: number }[]; readonly runMs: number } {
  const positions: { runMs: number }[] = [];
  let ordinal = 1;
  let runMs = 0;
  for (const track of sequence.tracks) {
    for (const segment of track.program ?? []) {
      const bodyLength = segment.kernels.length;
      segment.kernels.forEach((_kernel, offset) => {
        const cost = positionRunMs(
          sequence,
          costByRowId,
          ordinal,
          bodyLength,
          segment.repeat,
          offset,
        );
        positions.push({ runMs: cost });
        runMs += cost;
      });
      ordinal += bodyLength * segment.repeat;
    }
  }
  return { positions, runMs };
}

function costIndex(report: AlignmentIterationReport): ReadonlyMap<string, AlignmentKernelRow> {
  return new Map(report.kernels.map((row) => [row.rowId, row]));
}

/**
 * Every program the picker can offer, and what it left out.
 *
 * Phases keep the order the labeler wrote them in, which is the order they run
 * in; sorting them would put `forward` after `postprocess`.
 */
export function boardSequenceCatalog(
  sequences: AlignmentSequences,
  report: AlignmentIterationReport,
): BoardSequenceCatalog {
  const costByRowId = costIndex(report);
  const phaseOrder = Object.keys(sequences.phases).filter(
    (phase) => (sequences.phases[phase] ?? []).length > 0,
  );
  const phaseMs: Record<string, number> = {};
  const all: BoardSequenceOption[] = [];
  const offered: BoardSequenceOption[] = [];
  let omittedSequences = 0;
  let omittedMs = 0;

  for (const phase of phaseOrder) {
    const ranked = (sequences.phases[phase] ?? [])
      .map((sequence) => ({
        key: `${phase}/${sequence.sequenceId}`,
        phase,
        sequenceId: sequence.sequenceId,
        shortId: shortSequenceId(sequence.sequenceId),
        iterations: sequence.iterations.length,
        representativeIterationId:
          sequence.iterations[Math.floor(sequence.iterations.length / 2)] ?? null,
        expandedKernelCount: sequence.expandedKernelCount,
        runMs: sequence.totalMs ?? programCost(sequence, costByRowId).runMs,
      }))
      .sort((left, right) => right.runMs - left.runMs);
    phaseMs[phase] = ranked.reduce((total, entry) => total + entry.runMs, 0);
    all.push(...ranked);
    offered.push(...ranked.slice(0, SEQUENCES_OFFERED_PER_PHASE));
    for (const entry of ranked.slice(SEQUENCES_OFFERED_PER_PHASE)) {
      omittedSequences += 1;
      omittedMs += entry.runMs;
    }
  }
  return { phaseOrder, phaseMs, all, offered, omittedSequences, omittedMs };
}

/** The phase the model prices, and so the one worth opening on. Any capture
 * that has it has it under this name; a capture without one opens on whatever
 * ran first. */
const PRIMARY_PHASE = 'forward';

export function defaultPhase(catalog: BoardSequenceCatalog): string | null {
  if (catalog.phaseOrder.includes(PRIMARY_PHASE)) return PRIMARY_PHASE;
  return catalog.phaseOrder[0] ?? null;
}

/** The program each phase opens on: its costliest, which is also the first the
 * picker offers. */
export function defaultSequenceKeys(
  catalog: BoardSequenceCatalog,
): Readonly<Record<string, string>> {
  const chosen: Record<string, string> = {};
  for (const phase of catalog.phaseOrder) {
    const first = catalog.offered.find((entry) => entry.phase === phase);
    if (first !== undefined) chosen[phase] = first.key;
  }
  return chosen;
}

function findSequence(
  sequences: AlignmentSequences,
  phase: string,
  sequenceId: string,
): AlignmentSequence | undefined {
  return (sequences.phases[phase] ?? []).find((candidate) => candidate.sequenceId === sequenceId);
}

/** Pick the middle iteration from the same default program the board shows.
 * This keeps the initial measured and timing-predict views in one workload
 * family instead of silently switching stage at the middle of the capture. */
export function defaultBoardExampleIterationId(
  sequences: AlignmentSequences,
  report: AlignmentIterationReport,
): number | null {
  const catalog = boardSequenceCatalog(sequences, report);
  const phase = defaultPhase(catalog);
  if (phase === null) return null;
  const chosenKey = defaultSequenceKeys(catalog)[phase];
  const option = catalog.offered.find((entry) => entry.key === chosenKey);
  if (option === undefined) return null;
  return option.representativeIterationId;
}

/** Sequence choices that contain the selected iteration, one per phase. */
export function sequenceKeysForIteration(
  sequences: AlignmentSequences,
  catalog: BoardSequenceCatalog,
  iterationId: number,
): Readonly<Record<string, string>> {
  const chosen: Record<string, string> = {};
  for (const phase of catalog.phaseOrder) {
    const sequence = (sequences.phases[phase] ?? []).find((candidate) =>
      candidate.iterations.includes(iterationId),
    );
    if (sequence !== undefined) chosen[phase] = `${phase}/${sequence.sequenceId}`;
  }
  return chosen;
}

/** Bounded browse choices plus the current program when it fell outside the
 * bound. Limiting the picker must never change which iteration is displayed. */
export function sequenceOptionsForPhase(
  catalog: BoardSequenceCatalog,
  phase: string,
  chosenKey: string | undefined,
): readonly BoardSequenceOption[] {
  const offered = catalog.offered.filter((entry) => entry.phase === phase);
  const chosen = catalog.all.find((entry) => entry.key === chosenKey);
  return chosen === undefined || offered.some((entry) => entry.key === chosen.key)
    ? offered
    : [chosen, ...offered];
}

/**
 * The operation a slot is shown under.
 *
 * A slot can be claimed by several operations, because one fused kernel is
 * both a collective and a norm. The narrowest claim wins: an operation that
 * names this slot alone describes it exactly, where one that names three names
 * it only as part of a bundle.
 */
function slotOwners(
  report: AlignmentIterationReport,
): ReadonlyMap<
  string,
  { readonly operation: string; readonly type: string; readonly slots: number }
> {
  const owners = new Map<string, { operation: string; type: string; slots: number }>();
  for (const operation of report.mapping.operations) {
    for (const slot of operation.simulatedSlots) {
      const held = owners.get(slot);
      if (held === undefined || operation.simulatedSlots.length < held.slots) {
        owners.set(slot, {
          operation: operation.operation,
          type: operation.type,
          slots: operation.simulatedSlots.length,
        });
      }
    }
  }
  return owners;
}

/**
 * Price the structural slot card from one real iteration detail.
 *
 * The iteration payload can contain several expanded leaves with the same
 * structural name (one per expert/path). The board intentionally has one card
 * for that structural name. Keep only leaves attributed to the CostTree's
 * program, then take their multiplicity-weighted mean unit_ms. That is the
 * model-side analogue of the measured lane's mean rank-combined occurrence;
 * selecting whichever leaf happened to be serialized first would make the
 * result depend on payload order.
 */
function exampleSlotPrediction(
  predictionsByName: ReadonlyMap<string, readonly AlignmentBreakdown['simulatedKernels'][number][]>,
  slot: string,
): {
  readonly unitMs: number;
  readonly multiplicity: number | null;
  readonly samples: number;
} | null {
  const matching = predictionsByName.get(slot) ?? [];
  if (matching.length === 0) return null;
  const samples = matching;
  const totalMultiplicity = samples.reduce((total, kernel) => total + kernel.multiplicity, 0);
  const unitMs =
    totalMultiplicity === 0
      ? samples.reduce((total, kernel) => total + kernel.unitMs, 0) / samples.length
      : samples.reduce((total, kernel) => total + kernel.unitMs * kernel.multiplicity, 0) /
        totalMultiplicity;
  const multiplicities = new Set(samples.map((kernel) => kernel.multiplicity));
  return {
    unitMs,
    multiplicity: multiplicities.size === 1 ? (samples[0]?.multiplicity ?? null) : null,
    samples: samples.length,
  };
}

/** Both lanes of the board for one program per phase. */
export function boardLanes(
  sequences: AlignmentSequences,
  report: AlignmentIterationReport,
  chosenByPhase: Readonly<Record<string, string>>,
  catalog: BoardSequenceCatalog,
  /** Null keeps iteration-specific values empty; it never substitutes a
   * whole-capture average. */
  exampleBreakdown: AlignmentBreakdown | null,
  sequenceDetails: Readonly<Record<string, AlignmentSequence>> = {},
): BoardLanes {
  const operationColors = rotatingOperationColors(report.mapping.operations);
  const durationByRowId = new Map<string, number>();
  const predictionsByName = new Map<string, AlignmentBreakdown['simulatedKernels'][number][]>();
  if (exampleBreakdown !== null) {
    for (const kernel of exampleBreakdown.measuredKernels) {
      if (kernel.rowId !== null) durationByRowId.set(kernel.rowId, kernel.durationMs);
    }
    for (const kernel of exampleBreakdown.simulatedKernels) {
      const matching = predictionsByName.get(kernel.name);
      if (matching === undefined) predictionsByName.set(kernel.name, [kernel]);
      else matching.push(kernel);
    }
  }
  const measured: BoardKernelCard[] = [];
  const measuredGroups: BoardGroup[] = [];

  for (const phase of catalog.phaseOrder) {
    const chosenKey = chosenByPhase[phase];
    const option = catalog.all.find((entry) => entry.key === chosenKey);
    if (option === undefined) continue;
    const sequence =
      sequenceDetails[option.key] ?? findSequence(sequences, phase, option.sequenceId);
    if (sequence === undefined) continue;
    let ordinal = 1;
    for (const track of sequence.tracks) {
      const from = measured.length;
      for (const segment of track.program ?? []) {
        segment.kernels.forEach((kernel, offset) => {
          const label = kernel.label;
          const mapped = label.status === 'mapped' && label.operation !== undefined;
          const timing =
            exampleBreakdown === null
              ? null
              : exampleMeasuredUnitMs(
                  sequence,
                  durationByRowId,
                  ordinal,
                  segment.kernels.length,
                  segment.repeat,
                  offset,
                );
          measured.push({
            id: `m${measured.length}`,
            name: kernel.name,
            operationLabel: mapped ? (label.operation ?? '') : UNMAPPED_KERNEL_LABEL,
            mapped,
            color:
              mapped && label.operation !== undefined
                ? operationColors[label.operation]
                : familyColor(kernel.suggestedCategory, label.type ?? null),
            ms: timing?.ms ?? null,
            timingNote:
              timing === null
                ? 'selected iteration has no matching measured occurrence'
                : timing.samples === 1
                  ? 'one rank-combined occurrence in the selected iteration'
                  : `mean of ${timing.samples.toLocaleString()} rank-combined occurrences in the selected iteration`,
            repeat: segment.repeat,
            simulatedSlots: label.simulatedSlots ?? [],
            phase,
          });
        });
        ordinal += segment.kernels.length * segment.repeat;
      }
      if (measured.length > from) {
        measuredGroups.push({
          label: sequence.tracks.length === 1 ? phase : `${phase} · stream ${track.trackIndex}`,
          note:
            sequence.tracks.length === 1
              ? `${option.shortId} ×${option.iterations.toLocaleString()}`
              : `${track.streamRole} · ${option.shortId} ×${option.iterations.toLocaleString()}`,
          from,
          to: measured.length,
        });
      }
    }
  }

  const owners = slotOwners(report);
  const modelled: BoardSlotCard[] = [];
  const seen = new Set<string>();
  const addSlot = (slot: string) => {
    if (seen.has(slot)) return;
    seen.add(slot);
    const owner = owners.get(slot);
    const pairedKernel = measured.find(
      (kernel) => kernel.mapped && kernel.simulatedSlots.includes(slot),
    );
    const prediction =
      exampleBreakdown === null ? null : exampleSlotPrediction(predictionsByName, slot);
    modelled.push({
      id: `s${modelled.length}`,
      slot,
      operationLabel: pairedKernel?.operationLabel ?? owner?.operation ?? UNCLAIMED_SLOT_LABEL,
      claimed: pairedKernel !== undefined || owner !== undefined,
      color:
        pairedKernel?.color ??
        (owner === undefined ? familyColor('other', null) : operationColors[owner.operation]),
      repeat: prediction?.multiplicity ?? null,
      ms: prediction?.unitMs ?? null,
      timingNote:
        prediction === null
          ? 'selected iteration has no matching timing-predict leaf'
          : prediction.samples === 1
            ? 'one timing-predict leaf in the selected iteration'
            : `multiplicity-weighted mean of ${prediction.samples.toLocaleString()} timing-predict leaves in the selected iteration`,
    });
  };
  if (exampleBreakdown === null) {
    // Before one iteration is selected, show the static mapping inventory.
    for (const kernel of measured) for (const slot of kernel.simulatedSlots) addSlot(slot);
    for (const operation of report.mapping.operations) {
      for (const slot of operation.simulatedSlots) addSlot(slot);
    }
    for (const row of report.mapping.unmappedSimulatedSlots) addSlot(row.slot);
  } else {
    // The board explains one selected iteration, so its right lane must be that
    // iteration's executed workload rather than the union of every phase and
    // every static label. Zero-valued typed slots remain in the manifest for
    // stable logging but are not modelled work in this cycle.
    const activeSlots = new Set(
      exampleBreakdown.simulatedKernels
        .filter((kernel) => kernel.foldedMs > 0)
        .map((kernel) => kernel.name),
    );
    for (const kernel of measured) {
      for (const slot of kernel.simulatedSlots) if (activeSlots.has(slot)) addSlot(slot);
    }
    for (const kernel of exampleBreakdown.simulatedKernels) {
      if (kernel.foldedMs > 0) addSlot(kernel.name);
    }
  }

  // Once a real iteration prediction is available, its slot_index is the
  // model's canonical order. The measured-first order above is only the
  // fallback used while the detail is unavailable; keeping it as the final
  // order can put a later model leaf (for example moe_finalize) above an
  // earlier one (for example input_norm) just because the label file was
  // assembled from measured rows.
  if (exampleBreakdown !== null) {
    const predictionOrder = new Map<string, number>();
    for (const kernel of exampleBreakdown.simulatedKernels) {
      const firstIndex = predictionOrder.get(kernel.name);
      if (firstIndex === undefined || kernel.slotIndex < firstIndex) {
        predictionOrder.set(kernel.name, kernel.slotIndex);
      }
    }
    const originalOrder = new Map(modelled.map((card, index) => [card.slot, index]));
    modelled.sort(
      (left, right) =>
        (predictionOrder.get(left.slot) ?? Number.POSITIVE_INFINITY) -
          (predictionOrder.get(right.slot) ?? Number.POSITIVE_INFINITY) ||
        (originalOrder.get(left.slot) ?? 0) - (originalOrder.get(right.slot) ?? 0),
    );
  }

  const modelledGroups: BoardGroup[] = [
    {
      label: 'modelled slots',
      note: `${modelled.length} slot${modelled.length === 1 ? '' : 's'}`,
      from: 0,
      to: modelled.length,
    },
  ];
  const maximumMs = Math.max(
    0,
    ...measured.map((card) => card.ms ?? 0),
    ...modelled.map((card) => card.ms ?? 0),
  );
  return {
    measured,
    measuredGroups,
    modelled,
    modelledGroups,
    maximumMs,
  };
}

/** One join per tie the label file already declares. */
export function boardJoins(lanes: BoardLanes): readonly BoardJoin[] {
  const slotIndex = new Map(lanes.modelled.map((card, index) => [card.slot, index]));
  const joins: BoardJoin[] = [];
  lanes.measured.forEach((kernel, measuredIndex) => {
    for (const slot of kernel.simulatedSlots) {
      const modelledIndex = slotIndex.get(slot);
      if (modelledIndex === undefined) continue;
      joins.push({ measuredIndex, modelledIndex, color: kernel.color });
    }
  });
  return joins;
}

export interface BoardCoverage {
  readonly measuredDurationPct: number;
  readonly simulatedWorkloadPct: number;
  readonly unmappedKernelRows: number;
  readonly unmappedSlots: number;
}

export function boardCoverage(report: AlignmentIterationReport): BoardCoverage {
  const coverage = report.mapping.coverage;
  return {
    measuredDurationPct: coverage.measuredDurationFraction * 100,
    simulatedWorkloadPct: coverage.simulatedWorkloadFraction * 100,
    unmappedKernelRows: report.mapping.unmappedMeasuredKernelCount,
    unmappedSlots: report.mapping.unmappedSimulatedSlots.length,
  };
}
