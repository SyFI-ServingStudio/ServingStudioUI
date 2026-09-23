import type { AlignmentBreakdown } from '../../artifacts/schema/alignmentTypes';

/**
 * §03's view of the canonical per-iteration breakdown.
 *
 * Transport, validation, and caching belong to the artifact boundary. This
 * module only projects the decoded record into the smaller shape consumed by
 * the operation stack.
 */

export interface OperationSplitMeasuredKernel {
  readonly phase: string;
  readonly operation: string | null;
  readonly name: string;
  readonly durationMs: number;
  readonly concurrentHiddenMs: number;
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
  /** Additive reduced work before CUDA-stream overlap is removed. */
  readonly additiveMeasuredMs: number;
  readonly measuredMs: number;
  readonly concurrentHiddenMs: number;
  readonly simulatedMs: number;
  readonly deltaMs: number;
  readonly relativeDiffPct: number | null;
}

export interface OperationSplitCycle {
  readonly iterationId: number;
  readonly stage: string;
  readonly measuredMs: number;
  readonly additiveMeasuredMs: number;
  readonly concurrentHiddenMs: number;
  /** The modelled iteration cost the stack represents: the CostTree's critical
   * path, NOT the folded leaf workload. A Max fan-out (one child per EP rank /
   * DP group) makes the folded sum several times the cost actually paid, so
   * stacking it against the measured kernels compares two different things. */
  readonly simulatedMs: number;
  readonly unmappedMeasuredMs: number;
  readonly additiveUnmappedMeasuredMs: number;
  readonly unmappedSimulatedMs: number;
  readonly measuredKernels: readonly OperationSplitMeasuredKernel[];
  readonly simulatedSlots: readonly OperationSplitSimulatedSlot[];
  readonly operationSummary: readonly OperationSplitOperationSummary[];
}

/** The analyzer's name for the modelled value a slot contributes, shown so a
 * reader can look the number up rather than guess which duration is drawn. */
export const MODELLED_SLOT_FIELD = 'critical_path_ms';

interface MeasuredAttribution {
  readonly operationMs: ReadonlyMap<string, number>;
  readonly operationHiddenMs: ReadonlyMap<string, number>;
  readonly unmappedMs: number;
}

/**
 * Read the analyzer's critical-path attribution without recomputing it.
 *
 * `measured_ms`, per-kernel `duration_ms`, operation `measured_ms`, and
 * `unmapped_measured_ms` are produced by the same critical-path reduction.
 * The hidden time is audit evidence for only cross-stream overlap; subtracting
 * it here would miss same-stream PDL overlap and collective skew, creating a
 * second, incompatible definition of critical time.
 */
function measuredAttribution(breakdown: AlignmentBreakdown): MeasuredAttribution {
  return {
    operationMs: new Map(breakdown.operationSummary.map((row) => [row.operation, row.measuredMs])),
    operationHiddenMs: new Map(
      breakdown.operationSummary.map((row) => [row.operation, row.measuredConcurrentHiddenMs]),
    ),
    unmappedMs: breakdown.unmappedMeasuredMs,
  };
}

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
  const attribution = measuredAttribution(breakdown);
  return {
    iterationId: breakdown.iterationId,
    stage: breakdown.stage,
    measuredMs: breakdown.measuredCriticalPathMs,
    additiveMeasuredMs: breakdown.measuredKernelSumMs,
    concurrentHiddenMs: breakdown.measuredConcurrentHiddenMs,
    simulatedMs: breakdown.simulatedCriticalPathMs,
    unmappedMeasuredMs: attribution.unmappedMs,
    additiveUnmappedMeasuredMs: breakdown.unmappedMeasuredMs,
    unmappedSimulatedMs: breakdown.unmappedSimulatedMs,
    measuredKernels: breakdown.measuredKernels.map((kernel) => ({
      phase: kernel.phase ?? '',
      operation: kernel.operation,
      name: kernel.name,
      durationMs: kernel.durationMs,
      concurrentHiddenMs: kernel.concurrentHiddenMs,
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
      additiveMeasuredMs: row.measuredMs,
      measuredMs: attribution.operationMs.get(row.operation) ?? 0,
      concurrentHiddenMs: attribution.operationHiddenMs.get(row.operation) ?? 0,
      simulatedMs: row.simulatedMs,
      deltaMs: row.simulatedMs - (attribution.operationMs.get(row.operation) ?? 0),
      relativeDiffPct:
        (attribution.operationMs.get(row.operation) ?? 0) > 0
          ? ((row.simulatedMs - (attribution.operationMs.get(row.operation) ?? 0)) /
              (attribution.operationMs.get(row.operation) ?? 0)) *
            100
          : null,
    })),
  };
}
