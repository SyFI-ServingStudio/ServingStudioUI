import type { AlignmentBreakdown } from '../../domain/alignment';

/**
 * §03's view of the canonical per-iteration breakdown.
 *
 * Transport, validation and caching belong to AnalyzerRepository and the
 * application query layer. This module only projects the already-decoded
 * domain record into the smaller shape consumed by the operation stack.
 */

export interface OperationSplitMeasuredKernel {
  readonly phase: string;
  readonly operation: string | null;
  readonly name: string;
  readonly durationMs: number;
  readonly calls: number;
}

export interface OperationSplitSimulatedSlot {
  readonly slotIndex: number;
  readonly name: string;
  readonly kind: string;
  readonly operation: string | null;
  readonly multiplicity: number;
  readonly foldedMs: number;
}

export interface OperationSplitOperationSummary {
  readonly operation: string;
  readonly measuredMs: number;
  readonly simulatedMs: number;
  readonly deltaMs: number;
  readonly relativeDiffPct: number;
}

export interface OperationSplitCycle {
  readonly iterationId: number;
  readonly stage: string;
  readonly measuredMs: number;
  /** The folded leaf workload represented by the modelled stack. */
  readonly simulatedMs: number;
  readonly unmappedMeasuredMs: number;
  readonly unmappedSimulatedMs: number;
  readonly measuredKernels: readonly OperationSplitMeasuredKernel[];
  readonly simulatedSlots: readonly OperationSplitSimulatedSlot[];
  readonly operationSummary: readonly OperationSplitOperationSummary[];
}

/** The analyzer's name for the modelled value a slot contributes, shown so a
 * reader can look the number up rather than guess which duration is drawn. */
export const MODELLED_SLOT_FIELD = 'folded_ms';

/** Project one canonical breakdown without changing any timing semantics. */
export function cycleFromBreakdown(breakdown: AlignmentBreakdown): OperationSplitCycle {
  return {
    iterationId: breakdown.iterationId,
    stage: breakdown.stage,
    measuredMs: breakdown.measuredKernelSumMs,
    simulatedMs: breakdown.simulatedLeafWorkloadMs,
    unmappedMeasuredMs: breakdown.unmappedMeasuredMs,
    unmappedSimulatedMs: breakdown.unmappedSimulatedMs,
    measuredKernels: breakdown.measuredKernels.map((kernel) => ({
      phase: kernel.phase ?? '',
      operation: kernel.operation,
      name: kernel.name,
      durationMs: kernel.durationMs,
      calls: kernel.calls,
    })),
    simulatedSlots: breakdown.simulatedKernels.map((slot) => ({
      slotIndex: slot.slotIndex,
      name: slot.name,
      kind: slot.kind,
      operation: slot.operation,
      multiplicity: slot.multiplicity,
      foldedMs: slot.foldedMs,
    })),
    operationSummary: breakdown.operationSummary.map((row) => ({
      operation: row.operation,
      measuredMs: row.measuredMs,
      simulatedMs: row.simulatedMs,
      deltaMs: row.deltaMs,
      relativeDiffPct: row.relativeDiffPct,
    })),
  };
}
