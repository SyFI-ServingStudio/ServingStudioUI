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
  /** This slot's share of the modelled iteration cost. */
  readonly criticalPathMs: number;
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
  /** The modelled iteration cost the stack represents: the CostTree's critical
   * path, NOT the folded leaf workload. A Max fan-out (one child per EP rank /
   * DP group) makes the folded sum several times the cost actually paid, so
   * stacking it against the measured kernels compares two different things. */
  readonly simulatedMs: number;
  readonly unmappedMeasuredMs: number;
  readonly unmappedSimulatedMs: number;
  readonly measuredKernels: readonly OperationSplitMeasuredKernel[];
  readonly simulatedSlots: readonly OperationSplitSimulatedSlot[];
  readonly operationSummary: readonly OperationSplitOperationSummary[];
}

/** The analyzer's name for the modelled value a slot contributes, shown so a
 * reader can look the number up rather than guess which duration is drawn. */
export const MODELLED_SLOT_FIELD = 'critical_path_ms';

/**
 * Project one canonical breakdown without changing any timing semantics.
 *
 * Null when the breakdown carries no critical-path attribution, which is every
 * report the analyzer produced before 2026-08-04. The folded leaf workload is
 * not a stand-in for it — under a Max fan-out it is several times the modelled
 * cost — so the section shows no per-cycle stack rather than a wrong one.
 */
export function cycleFromBreakdown(breakdown: AlignmentBreakdown): OperationSplitCycle | null {
  if (breakdown.simulatedCriticalPathMs === null) return null;
  return {
    iterationId: breakdown.iterationId,
    stage: breakdown.stage,
    measuredMs: breakdown.measuredKernelSumMs,
    simulatedMs: breakdown.simulatedCriticalPathMs,
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
      // The slot field and the iteration total arrive from one producer, so a
      // non-null total means every slot carries one; the fallback only settles
      // the type.
      criticalPathMs: slot.criticalPathMs ?? 0,
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
