/*
 * iterations.ts — the TIME axis (scheduler iteration / step), orthogonal to the
 * structural Run▸Pool▸Worker▸Kernel drill. VibeSim evaluates the cost tree once
 * per iteration against that step's batch, so the tree "breathes": a prefill
 * admission step inflates attn.prefill and the GEMMs; a steady decode step
 * collapses to attn.decode. `treeAtIter` reweights leaf costs by the step's
 * prefill/decode mix (normalised so the mean step ≈ the base per-iteration tree).
 * The current production core does not expose this capability; callers must
 * eventually receive the repository-owned worker timeline before enabling it.
 */
import {
  annotate,
  max,
  scale,
  sum,
  type CostNode,
  type CostTree,
  type LeafNode,
  type RawCostNode,
} from './tree';
import type { Run } from '../domain/run';
import type { WorkerKey } from '../domain/worker';

export interface Iteration {
  id: number;
  timeMs: number;
  prefillTokens: number;
  decodeRequests: number;
  batchTokens: number;
  phase: 'prefill' | 'mixed' | 'decode';
}
export interface IterTimeline {
  iters: Iteration[];
  ref: { prefillTokens: number; decodeRequests: number; batchTokens: number };
  spanMs: number;
}

/** Guard the unfinished worker-timeline integration. Keeping this failure
 * explicit prevents a future capability flag from reviving fabricated steps;
 * the owning feature must pass repository data through its own Query boundary. */
export function iterationsFor(run: Run, workerKey: WorkerKey): IterTimeline {
  throw new Error(
    `Worker timeline detail is not wired for run ${run.id}, worker ${workerKey}; load it through AnalyzerRepository.`,
  );
}

/** The worker's step nearest a wall-clock time (ms). Steps are time-sorted, so
 *  binary-search — this runs over thousands of steps on every cursor move. */
export function nearestIter(tl: IterTimeline, ms: number): Iteration {
  const a = tl.iters;
  let lo = 0,
    hi = a.length - 1;
  if (ms <= a[0].timeMs) return a[0];
  if (ms >= a[hi].timeMs) return a[hi];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].timeMs < ms) lo = mid + 1;
    else hi = mid;
  }
  const hiIt = a[lo];
  const loIt = a[lo - 1];
  return ms - loIt.timeMs <= hiIt.timeMs - ms ? loIt : hiIt;
}

// deep-clone the cost structure with each leaf's base scaled by f (topology and
// slot identity preserved → re-annotate assigns the SAME ids, so leaf selection
// survives an iteration change)
function cloneScaled(node: CostNode, factor: (leafNode: LeafNode) => number): RawCostNode {
  switch (node.kind) {
    case 'leaf':
      return { kind: 'leaf', slot: node.slot, base: node.base * factor(node) };
    case 'sum': {
      const [first, ...rest] = node.children;
      return sum(
        node.label,
        cloneScaled(first, factor),
        ...rest.map((child) => cloneScaled(child, factor)),
      );
    }
    case 'max': {
      const [first, ...rest] = node.children;
      return max(
        node.label,
        node.overlap,
        cloneScaled(first, factor),
        ...rest.map((child) => cloneScaled(child, factor)),
      );
    }
    case 'scale':
      return scale(node.label, node.n, cloneScaled(node.children[0], factor));
  }
}

/** Cost tree as evaluated at one iteration (or the base tree when it === null). */
export function treeAtIter(
  tree: CostTree,
  it: Iteration | null,
  ref: IterTimeline['ref'],
): CostTree {
  if (!it) return tree;
  const factor = (leafNode: LeafNode): number => {
    const kind = leafNode.slot.kind;
    if (kind === 'flashinfer_attn_prefill') return it.prefillTokens / ref.prefillTokens;
    if (kind === 'flashinfer_attn_decode') return it.decodeRequests / ref.decodeRequests;
    // GEMMs, norms, collectives, routing all scale with the batched-token count
    return it.batchTokens / ref.batchTokens;
  };
  return annotate(cloneScaled(tree, factor));
}
