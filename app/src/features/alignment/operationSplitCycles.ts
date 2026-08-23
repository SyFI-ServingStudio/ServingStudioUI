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
  readonly relativeDiffPct: number;
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
 * Attribute the one measured critical-path total back to operation buckets.
 *
 * Per-operation rows are reduced across ranks independently, while the
 * iteration owns one cross-operation overlap discount. Their hidden-time
 * evidence can therefore sum above or below that one discount when different
 * ranks are critical for different operations. First cap/renormalize the
 * operation evidence to the iteration budget, then charge any remainder to
 * unmapped work and finally to the still-visible mapped work. The result is
 * non-negative and adds back to the exact headline instead of serializing
 * concurrent CUDA streams in the UI.
 */
function measuredAttribution(breakdown: AlignmentBreakdown): MeasuredAttribution {
  const hiddenBudget = Math.min(
    breakdown.measuredConcurrentHiddenMs,
    breakdown.measuredKernelSumMs,
  );
  const mappedBudget = Math.max(0, breakdown.measuredKernelSumMs - breakdown.unmappedMeasuredMs);
  const operationAdditiveSum = breakdown.operationSummary.reduce(
    (sum, row) => sum + row.measuredMs,
    0,
  );
  const mappedScale = operationAdditiveSum > 0 ? mappedBudget / operationAdditiveSum : 0;
  const operationBase = new Map<string, number>();
  const operationHidden = new Map<string, number>();
  for (const row of breakdown.operationSummary) {
    const base = Math.max(0, row.measuredMs * mappedScale);
    operationBase.set(row.operation, base);
    operationHidden.set(
      row.operation,
      Math.min(base, Math.max(0, row.measuredConcurrentHiddenMs * mappedScale)),
    );
  }

  let attributedHidden = [...operationHidden.values()].reduce((sum, value) => sum + value, 0);
  if (attributedHidden > hiddenBudget && attributedHidden > 0) {
    const scale = hiddenBudget / attributedHidden;
    for (const [operation, value] of operationHidden) {
      operationHidden.set(operation, value * scale);
    }
    attributedHidden = hiddenBudget;
  }

  let remainingHidden = Math.max(0, hiddenBudget - attributedHidden);
  const unmappedHidden = Math.min(breakdown.unmappedMeasuredMs, remainingHidden);
  remainingHidden -= unmappedHidden;
  if (remainingHidden > 0) {
    const available = [...operationBase].reduce(
      (sum, [operation, base]) => sum + Math.max(0, base - (operationHidden.get(operation) ?? 0)),
      0,
    );
    if (available > 0) {
      const share = Math.min(1, remainingHidden / available);
      for (const [operation, base] of operationBase) {
        const hidden = operationHidden.get(operation) ?? 0;
        operationHidden.set(operation, hidden + Math.max(0, base - hidden) * share);
      }
    }
  }

  return {
    operationMs: new Map(
      [...operationBase].map(([operation, base]) => [
        operation,
        Math.max(0, base - (operationHidden.get(operation) ?? 0)),
      ]),
    ),
    operationHiddenMs: operationHidden,
    unmappedMs: Math.max(0, breakdown.unmappedMeasuredMs - unmappedHidden),
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
    measuredMs: Math.max(0, breakdown.measuredKernelSumMs - breakdown.measuredConcurrentHiddenMs),
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
          : 0,
    })),
  };
}
