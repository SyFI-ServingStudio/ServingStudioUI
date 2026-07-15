/*
 * scopeData.ts — scope-level derived payloads that don't come from the cost tree.
 *   conservationFor(run)   → cluster: workload-accounting checks (analyzer's
 *                            workload-conservation subject)
 *   batchFor(run, pool)    → pool: batched-token composition over time (analyzer's
 *                            batch composition subject)
 *   workerBatchFor(...)    → worker: the same subject derived from that worker's
 *                            scheduler iterations, so it matches iteration drill
 * Deterministic by run id (+ pool) so a backend can swap these for real payloads.
 */
import type { BatchSeries, CheckStatus, Conservation, ConservationCheck, Run } from '../domain/run';
import type { WorkerKey } from '../domain/worker';
import { iterationsFor } from './iterations';

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

// ---- workload conservation (cluster) ---------------------------------------
export function conservationFor(run: Run): Conservation {
  const r = rng(strHash(run.id) ^ 0x9e3779b9);
  const reqs = run.summary.requests;
  const mk = (
    name: string,
    description: string,
    base: number,
    jitter: number,
  ): ConservationCheck => {
    const expected = base;
    const actual = base * (1 + (r() - 0.5) * jitter);
    const deltaPct = ((actual - expected) / expected) * 100;
    const ad = Math.abs(deltaPct);
    const status: CheckStatus = ad < 0.5 ? 'ok' : ad < 5 ? 'warn' : 'fail';
    return {
      name,
      description,
      actual: Math.round(actual),
      expected: Math.round(expected),
      deltaPct: +deltaPct.toFixed(2),
      status,
    };
  };
  const checks = [
    mk('prefill_tokens', 'Σ cost_log prefill vs Σ request prompt_len', reqs * 512, 0.002),
    mk('decode_passes', 'Σ decode_request_count vs Σ max(gen_len − 1, 0)', reqs * 480, 0.006),
    mk('kv_appends', 'KV-append invocations vs decoded tokens', reqs * 480, 0.001),
    mk('ffn_routed_tokens', 'MoE FFN routed tokens vs router dispatch', reqs * 512 * 8, 0.03),
  ];
  return { allOk: checks.every((c) => c.status === 'ok'), checks };
}

// ---- batch composition (pool) ----------------------------------------------
export function batchFor(run: Run, poolRole: string): BatchSeries {
  const r = rng(strHash(run.id + ':' + poolRole));
  const n = 56;
  const span = run.deployment === 'afd' || run.summary.num_gpus > 1 ? 60000 : 22000;
  const isFfn = poolRole.indexOf('ffn') >= 0;
  const isAttn = poolRole.indexOf('attn') >= 0;
  const avgBatch = isFfn ? 3600 : isAttn ? 2400 : 3000;
  const prefillFrac = isFfn ? 0.42 : 0.36;
  const t: number[] = [];
  const bt: number[] = [];
  const pf: number[] = [];
  const dr: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const ramp = Math.min(1, f * 3.2);
    const wob = 1 + 0.14 * Math.sin(f * 11) + (r() - 0.5) * 0.12;
    const batch = avgBatch * ramp * wob;
    const prefill = batch * (prefillFrac + (r() - 0.5) * 0.05);
    t.push(+(((i + 0.5) / n) * span).toFixed(0));
    bt.push(Math.round(Math.max(0, batch)));
    pf.push(Math.round(Math.max(0, prefill)));
    dr.push(Math.round(Math.max(0, (batch - prefill) / 48))); // ≈ concurrent decode requests
  }
  return { t_ms: t, batchTokens: bt, prefillTokens: pf, decodeRequests: dr };
}

/** Worker composition comes from the worker-owned iteration stream rather than
 *  a second synthetic series. This keeps the chart, iteration strip, selected
 *  step readout, and cost-tree reweighting on one source of truth. */
export function workerBatchFor(run: Run, workerKey: WorkerKey): BatchSeries {
  const timeline = iterationsFor(run, workerKey);
  return {
    t_ms: timeline.iters.map((iteration) => iteration.timeMs),
    batchTokens: timeline.iters.map((iteration) => iteration.batchTokens),
    prefillTokens: timeline.iters.map((iteration) => iteration.prefillTokens),
    decodeRequests: timeline.iters.map((iteration) => iteration.decodeRequests),
  };
}
