/*
 * iterations.ts — the TIME axis (scheduler iteration / step), orthogonal to the
 * structural Run▸Pool▸Worker▸Kernel drill. VibeSim evaluates the cost tree once
 * per iteration against that step's batch, so the tree "breathes": a prefill
 * admission step inflates attn.prefill and the GEMMs; a steady decode step
 * collapses to attn.decode. `treeAtIter` reweights leaf costs by the step's
 * prefill/decode mix (normalised so the mean step ≈ the base per-iteration tree).
 * Deterministic by run id so a backend can swap these for real cost_log steps.
 */
import { annotate, type CostNode } from './tree';
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

function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const tlCache = new Map<string, IterTimeline>();

/** Per-WORKER scheduler-step stream. Each worker runs its own iterations (AFD
 *  attn vs ffn step on different cadences; even in a unified run the batch
 *  composition is per-worker). Timestamps share the run's wall-clock span so a
 *  wall-clock cursor can resolve to each worker's nearest step. */
export function iterationsFor(run: Run, workerKey: WorkerKey): IterTimeline {
  const key = `${run.id}::${workerKey}`;
  const hit = tlCache.get(key);
  if (hit) return hit;
  const w = run.workerList.find((x) => x.key === workerKey);
  const pool = w?.pool ?? 'main';
  const r = rng(strHash(key) ^ 0x5bd1e995);
  const multi = run.deployment === 'afd' || run.summary.num_gpus > 1;
  // numerous per-worker steps (hundreds–thousands), varied so worker timelines
  // don't move in lockstep — drives the windowed/scrolling iteration view
  const n = (multi ? 1500 : 480) + Math.floor(r() * (multi ? 260 : 90));
  // This generator is synthetic-only, but Run also represents artifact-backed
  // pages where throughput is optional. Keep its authoring fallback local
  // instead of pretending a missing subject produced an empty payload.
  const tp = run.payloads.throughput?.t_end_ms ?? [];
  const spanMs = tp[tp.length - 1] || (multi ? 60000 : 22000);
  const ffn = pool.indexOf('ffn') >= 0;
  const attn = pool.indexOf('attn') >= 0;
  const admitEvery = ffn ? 5 : attn ? 8 : 6;
  const decodeCap = attn ? 288 : ffn ? 224 : 256;
  const tokScale = ffn ? 1.25 : attn ? 0.8 : 1.0;
  const iters: Iteration[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const warm = f < 0.14; // initial burst of chunked prefill
    const admit = warm || i % admitEvery === 0; // periodic new-request admission
    const prefillTokens = Math.round(
      (admit ? (warm ? 1600 * (1 - f * 2) + 300 : 700 * r() + 120) : 30 * r()) * tokScale,
    );
    const decodeRequests = Math.round(
      Math.min(decodeCap, 16 + f * (decodeCap - 24)) * (1 + (r() - 0.5) * 0.18),
    );
    const pf = Math.max(0, prefillTokens);
    const dc = Math.max(0, decodeRequests);
    const batchTokens = Math.max(1, pf + dc);
    const phase: Iteration['phase'] = pf > dc ? 'prefill' : pf < dc * 0.25 ? 'decode' : 'mixed';
    iters.push({
      id: i,
      timeMs: +(((i + 0.5) / n) * spanMs).toFixed(0),
      prefillTokens: pf,
      decodeRequests: dc,
      batchTokens,
      phase,
    });
  }
  const mean = (sel: (it: Iteration) => number) =>
    iters.reduce((a, it) => a + sel(it), 0) / iters.length;
  const ref = {
    prefillTokens: mean((it) => it.prefillTokens) || 1,
    decodeRequests: mean((it) => it.decodeRequests) || 1,
    batchTokens: mean((it) => it.batchTokens) || 1,
  };
  const tl: IterTimeline = { iters, ref, spanMs };
  tlCache.set(key, tl);
  return tl;
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
function cloneScaled(node: CostNode, f: (n: CostNode) => number): CostNode {
  if (node.kind === 'leaf') {
    return { kind: 'leaf', slot: node.slot, base: (node.base ?? 0) * f(node) } as CostNode;
  }
  const out = { kind: node.kind, label: node.label } as CostNode;
  if (node.kind === 'max') out.overlap = node.overlap;
  if (node.kind === 'scale') out.n = node.n;
  out.children = (node.children ?? []).map((c) => cloneScaled(c, f));
  return out;
}

/** Cost tree as evaluated at one iteration (or the base tree when it === null). */
export function treeAtIter(
  tree: CostNode,
  it: Iteration | null,
  ref: IterTimeline['ref'],
): CostNode {
  if (!it) return tree;
  const factor = (n: CostNode): number => {
    const kind = n.slot!.kind;
    if (kind === 'flashinfer_attn_prefill') return it.prefillTokens / ref.prefillTokens;
    if (kind === 'flashinfer_attn_decode') return it.decodeRequests / ref.decodeRequests;
    // GEMMs, norms, collectives, routing all scale with the batched-token count
    return it.batchTokens / ref.batchTokens;
  };
  return annotate(cloneScaled(tree, factor));
}

export const PHASE_COLOR: Record<Iteration['phase'], string> = {
  prefill: '#a84b2e',
  mixed: '#806600',
  decode: '#1f6f6b',
};
