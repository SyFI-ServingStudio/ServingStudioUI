import type { WorkerRef } from './worker';
import type { CostTree } from './cost-tree';

export type WorkerOperationKind = 'afd_attn' | 'afd_ffn' | 'iterwise';
export type WorkerOperationBatchRole = 'slot' | 'batch';

/** Exact identity of one raw worker-cost row. Iter/batch remain part of the
 * tuple because operation ids are intentionally scoped to their parent batch. */
export interface OperationRef {
  readonly iterId: string;
  readonly batchId: string;
  readonly operationId: string;
}

/** Bounded timeline fact used by the operation canvas. Batch identity is also
 * the stable color discriminator; it never creates a separate visual row. */
export interface OperationSummary {
  readonly ordinal: number;
  readonly ref: OperationRef;
  readonly section: string;
  readonly layer: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface WorkerOperationBuffer {
  readonly worker: WorkerRef;
  readonly workerKind: WorkerOperationKind;
  readonly batchRole: WorkerOperationBatchRole;
  readonly span: { readonly startMs: number; readonly endMs: number };
  readonly offset: number;
  readonly total: number;
  readonly operations: readonly OperationSummary[];
}

export interface WorkerOperationSeekResult {
  readonly worker: WorkerRef;
  readonly workerKind: WorkerOperationKind;
  readonly batchRole: WorkerOperationBatchRole;
  readonly atMs: number;
  readonly totalOperations: number;
  readonly span: { readonly startMs: number; readonly endMs: number };
  readonly hits: readonly OperationSummary[];
  readonly anchor: { readonly ordinal: number; readonly kind: 'hit' | 'nearest' };
  readonly suggestedViewport: { readonly offset: number; readonly limit: number };
  readonly buffer: WorkerOperationBuffer;
}

export interface WorkerCostTreeRef extends OperationRef {
  readonly worker: WorkerRef;
}

export interface WorkerCostTreeDetail extends WorkerCostTreeRef {
  readonly section: string;
  readonly layer: number;
  readonly interval: { readonly startMs: number; readonly endMs: number };
  readonly inputs: readonly WorkerCostTreeInput[];
  readonly tree: CostTree;
}

export interface WorkerCostTreeGroupInput {
  readonly batchTokens: number;
  readonly prefillTokens: number;
  readonly decodeRequestCount: number;
  readonly decodeKvTotal: number;
  readonly prefillChunkPairs: readonly (readonly [number, number])[];
}

export interface WorkerCostTreeInput {
  readonly section: string;
  readonly layer: number | null;
  readonly groups: readonly WorkerCostTreeGroupInput[];
}

export function workerOperationLabel(operation: OperationSummary): string {
  return `${operation.section} · layer ${operation.layer}`;
}
