/** Scoped optimality — the R0/R5/R6/R7 ladder computed for one CostTree
 * subtree on demand. Rungs that are not well-defined at subtree scope
 * (idle, imbalance, communication, balanced) arrive as omissions with the
 * analyzer's stated reason rather than as numbers. */

export interface ScopedOptimalitySelector {
  readonly path?: string;
  readonly label?: string;
}

export interface ScopedOptimalityRung {
  readonly key: string;
  readonly gpuSeconds: number;
  readonly definition: string;
}

export interface ScopedOptimalityOmission {
  readonly rung: string;
  readonly reason: string;
}

export interface ScopedOptimalityReport {
  readonly section: string;
  readonly canonicalPath: string;
  readonly nodeKind: string;
  readonly nodeLabel: string | null;
  readonly matchedWorkers: number;
  readonly matchedRows: number;
  readonly descendantLeaves: readonly string[];
  readonly rungs: readonly ScopedOptimalityRung[];
  readonly omittedRungs: readonly ScopedOptimalityOmission[];
}

/** Display order and captions for the scoped rung keys the analyzer emits. */
export const SCOPED_RUNG_LABELS: Readonly<Record<string, string>> = {
  r0_measured: 'R0 measured',
  r5_hardware_limit: 'R5 hardware limit',
  r6_segmented_necessary: 'R6 segmented necessary',
  r7_scope_fused_necessary: 'R7 scope-fused necessary',
};

export function scopedRungLabel(key: string): string {
  return SCOPED_RUNG_LABELS[key] ?? key;
}
