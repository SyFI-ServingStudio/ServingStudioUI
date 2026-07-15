import type { KernelTimeWorkerComposition } from '../domain/kernelTimeShare';
import { annotate, leaf, sum, type CostNode } from './tree';

/** Project one analyzer worker composition into the legacy visual CostNode.
 * This happens only behind `getWorkerCostTree`; aggregate screens consume the
 * analyzer's overlap-aware overall/pool compositions directly. */
export function projectKernelTimeWorkerTree(worker: KernelTimeWorkerComposition): CostNode {
  return annotate(
    sum(
      `run aggregate · ${worker.ref.poolTag}/${worker.ref.workerId}`,
      ...worker.segments.map((segment) =>
        leaf(
          segment.position,
          segment.kind,
          `run aggregate · share_pct=${segment.sharePct}`,
          segment.kernelTimeMs,
        ),
      ),
    ),
  );
}
