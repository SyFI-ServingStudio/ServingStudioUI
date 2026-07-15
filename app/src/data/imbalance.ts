/*
 * imbalance.ts — analytics for a Max ("parallel") cost node. A Max models work
 * that runs concurrently across P lanes (rank/expert/overlap branches); the
 * node's wall-time is the STRAGGLER (slowest lane). This derives how load is
 * spread across those lanes over the run, which lane straggles, and the
 * straggler's representative kernel. Deterministic by (worker id, node id) so a
 * backend can swap in real per-rank samples later.
 */
import type { Run, WorkerRow } from '../domain/run';
import { type CostNode, type LeafNode, type MaxNode } from './tree';
import { iterationsFor } from './iterations';

// integer hash → [0,1); stable, no Date/Math.random (matches kernel.ts)
function hsh(n: number): number {
  let x = Math.imul(n, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function collectLeaves(node: CostNode): LeafNode[] {
  const out: LeafNode[] = [];
  (function walk(n: CostNode) {
    if (n.kind === 'leaf') out.push(n);
    else n.children.forEach(walk);
  })(node);
  return out;
}
export function heaviestLeaf(node: CostNode): LeafNode {
  const [first, ...rest] = collectLeaves(node);
  if (first === undefined) throw new Error('A validated CostTree node must contain a leaf.');
  return rest.reduce(
    (heaviest, leafNode) => (leafNode.ms > heaviest.ms ? leafNode : heaviest),
    first,
  );
}
/** Is this node worth a parallel/straggler inspection? (a Max with ≥2 branches) */
export const isParallelNode = (node: CostNode): node is MaxNode => node.kind === 'max';

type Dim = 'expert' | 'rank' | 'branch';
interface LaneSpec {
  lanes: number;
  label: string;
  dim: Dim;
}

/** How many concurrent lanes this Max spans, and what they represent — inferred
 *  from the worker's parallelism (EP experts / TP ranks) and the node's kernels. */
function laneSpec(w: WorkerRow, node: MaxNode): LaneSpec {
  const p = w.arch.params as Record<string, number | string>;
  const kinds = new Set(collectLeaves(node).map((leafNode) => leafNode.slot.kind));
  const hasGrouped = [...kinds].some(
    (k) => k === 'grouped_gemm' || k === 'moe_router' || k.startsWith('p2p'),
  );
  const hasAttn = [...kinds].some((k) => k.includes('attn') || k === 'all_reduce');
  const ep = Number(p.ep) || 0;
  const tp = Number(p.attn_tp) || 0;
  if (ep > 1 && hasGrouped) return { lanes: ep, label: `EP experts · ${ep} ranks`, dim: 'expert' };
  if (tp > 1 && hasAttn) return { lanes: tp, label: `TP attn · ${tp} ranks`, dim: 'rank' };
  const kids = node.children.length;
  return { lanes: Math.max(2, kids), label: `${kids} overlap branches`, dim: 'branch' };
}

export interface Imbalance {
  label: string;
  dim: Dim;
  lanes: number;
  overlap: number; // the Max node's overlap factor
  nodeMs: number; // straggler-set wall-time of the node (aggregate)
  t_ms: number[];
  maxLoad: number[];
  meanLoad: number[];
  minLoad: number[];
  imbalancePct: number[];
  perLaneAvg: number[]; // per-lane mean load, normalised so mean lane = 1
  laneLabels: string[];
  stragglerLane: number; // index of the slowest lane
  stragglerFactor: number; // straggler load ÷ mean lane
  maxImbalancePct: number;
  avgImbalancePct: number;
  stragglerLeafId: number;
  stragglerName: string;
}

/** Per-lane load over the run for a Max node, plus straggler identification. */
export function imbalanceFor(run: Run, w: WorkerRow, node: MaxNode): Imbalance {
  const spec = laneSpec(w, node);
  const P = spec.lanes;
  const tl = iterationsFor(run, w.key);
  const refBatch = Math.max(1, tl.ref.batchTokens);
  const refPrefill = Math.max(1, tl.ref.prefillTokens);
  const refDecode = Math.max(1, tl.ref.decodeRequests);
  const seed = strHash(`${w.key}:${node.id}`);

  // per-branch driver (only used when dim === 'branch'): prefill vs decode vs batch
  const kids = node.children;
  const branchDriver = kids.map((child) => {
    const nm = (collectLeaves(child)[0]?.slot.name ?? '').toLowerCase();
    return nm.includes('prefill') ? 'prefill' : nm.includes('decode') ? 'decode' : 'batch';
  });
  const branchMs = kids.map((c) => Math.max(1e-3, c.ms));
  const branchMsMean = branchMs.reduce((a, b) => a + b, 0) / Math.max(1, branchMs.length);

  // persistent per-lane weight (skew): experts power-law hot, ranks mild, branches by ms
  const laneWeight: number[] = [];
  const laneLabels: string[] = [];
  for (let k = 0; k < P; k++) {
    let wgt = 1;
    if (spec.dim === 'expert') {
      const r = hsh(seed + k * 97 + 3);
      wgt = 0.55 + Math.pow(r, 3) * 2.8;
      laneLabels.push(`e${k}`);
    } else if (spec.dim === 'rank') {
      const r = hsh(seed + k * 57 + 3);
      wgt = 0.9 + r * 0.34;
      laneLabels.push(`r${k}`);
    } else {
      wgt = (branchMs[k] ?? branchMsMean) / branchMsMean;
      const branch = kids[k];
      laneLabels.push(
        branch === undefined
          ? `b${k}`
          : (collectLeaves(branch)[0]?.slot.name.split('.').pop() ?? `b${k}`),
      );
    }
    laneWeight.push(wgt);
  }
  let stragglerLane = 0;
  for (let k = 1; k < P; k++) if (laneWeight[k] > laneWeight[stragglerLane]) stragglerLane = k;

  const N = Math.min(72, tl.iters.length);
  const t_ms: number[] = [],
    maxLoad: number[] = [],
    meanLoad: number[] = [],
    minLoad: number[] = [],
    imbalancePct: number[] = [];
  const laneSum = new Array(P).fill(0);
  let steps = 0;
  for (let s = 0; s < N; s++) {
    const it =
      tl.iters[Math.min(tl.iters.length - 1, Math.floor(((s + 0.5) / N) * tl.iters.length))];
    const intensity = it.batchTokens / refBatch;
    let mx = -Infinity,
      mn = Infinity,
      sum = 0;
    for (let k = 0; k < P; k++) {
      let load: number;
      if (spec.dim === 'branch') {
        const drv =
          branchDriver[k] === 'prefill'
            ? it.prefillTokens / refPrefill
            : branchDriver[k] === 'decode'
              ? it.decodeRequests / refDecode
              : intensity;
        load = laneWeight[k] * drv;
      } else {
        const noise = 1 + (hsh(seed + k * 131 + s * 7) - 0.5) * 0.3;
        load = laneWeight[k] * intensity * noise;
      }
      laneSum[k] += load;
      if (load > mx) mx = load;
      if (load < mn) mn = load;
      sum += load;
    }
    steps++;
    const mean = sum / P;
    t_ms.push(it.timeMs);
    maxLoad.push(+mx.toFixed(3));
    meanLoad.push(+mean.toFixed(3));
    minLoad.push(+mn.toFixed(3));
    imbalancePct.push(mean > 0 ? +(((mx - mean) / mean) * 100).toFixed(1) : 0);
  }

  const perLaneRaw = laneSum.map((x) => x / Math.max(1, steps));
  const overall = perLaneRaw.reduce((a, b) => a + b, 0) / P || 1;
  const perLaneAvg = perLaneRaw.map((x) => +(x / overall).toFixed(3));
  const maxImbalancePct = imbalancePct.reduce((a, b) => Math.max(a, b), 0);
  const avgImbalancePct =
    imbalancePct.reduce((a, b) => a + b, 0) / Math.max(1, imbalancePct.length);
  const sLeaf = heaviestLeaf(node);

  return {
    label: spec.label,
    dim: spec.dim,
    lanes: P,
    overlap: node.overlap,
    nodeMs: node.ms,
    t_ms,
    maxLoad,
    meanLoad,
    minLoad,
    imbalancePct,
    perLaneAvg,
    laneLabels,
    stragglerLane,
    stragglerFactor: +perLaneAvg[stragglerLane].toFixed(2),
    maxImbalancePct: +maxImbalancePct.toFixed(0),
    avgImbalancePct: +avgImbalancePct.toFixed(0),
    stragglerLeafId: sLeaf.id,
    stragglerName: sLeaf.slot.name,
  };
}
