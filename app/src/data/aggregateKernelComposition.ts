import {
  KERNEL_TIME_EPSILON_MS,
  type AggregateWorkerKernelComposition,
} from '../domain/kernelTimeShare';
import type { WorkerRef } from '../domain/worker';
import { annotate, leaf, sum, type CostTree, type RawLeafNode } from './tree';

/**
 * Explicit wrapper for a flat full-run projection. Keeping the evidence kind
 * beside the visual tree prevents callers from presenting it as the separately
 * versioned `worker-cost-tree` hierarchical detail resource.
 */
export interface AggregateKernelVisualTree {
  readonly evidence: 'aggregate-kernel-composition';
  readonly worker: WorkerRef;
  readonly tree: CostTree;
}

function aggregateLeaf(segment: AggregateWorkerKernelComposition['segments'][number]): RawLeafNode {
  return leaf(
    segment.position,
    segment.kind,
    `run aggregate · share_pct=${segment.sharePct}`,
    segment.kernelTimeMs,
  );
}

/** Return null for a valid zero-kernel-time worker rather than inventing an
 * empty Sum, which is not a valid CostTree combinator. */
export function projectAggregateKernelVisualTree(
  worker: AggregateWorkerKernelComposition,
): AggregateKernelVisualTree | null {
  if (worker.kernelTimeMs <= KERNEL_TIME_EPSILON_MS) return null;
  const [first, ...rest] = worker.segments;
  if (first === undefined) return null;
  const tree = annotate(
    sum(
      `run aggregate · ${worker.ref.poolTag}/${worker.ref.workerId}`,
      aggregateLeaf(first),
      ...rest.map(aggregateLeaf),
    ),
  );
  return Object.freeze({
    evidence: 'aggregate-kernel-composition',
    worker: worker.ref,
    tree,
  });
}
