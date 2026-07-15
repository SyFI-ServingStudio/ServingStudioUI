/*
 * fakeData.ts — 3 deterministic fake VibeSim runs (ported from shared/data.js).
 * Mirrors real artifact shapes so a backend can swap in later (only this file
 * would be replaced by fetches to logs/<run>/…/payloads + run_meta.json).
 */
import { annotate, leaf, sum, max, scale, type CostNode } from './tree';

// ---- payload types ---------------------------------------------------------
export interface SloMetric {
  label: string;
  unit: string;
  x: number[];
  y_pct: number[];
  markers: { p50: number; p90: number; p99: number };
}
export interface Slo { ttft: SloMetric; tpot: SloMetric; e2e: SloMetric; }
export interface Throughput { t_start_ms: number[]; t_end_ms: number[]; total: number[]; prefill: number[]; decode: number[]; }
export interface UtilSeries { t_ms: number[]; series: { key: string; label: string; util: number[] }[]; }
export interface KvSeries { t_ms: number[]; series: { label: string; capacity: number; active: number[] }[]; }
/** In-flight requests in the whole system over wall-clock (admitted − completed). */
export interface Concurrency { t_ms: number[]; active: number[]; peak: number; }
export interface PendingQueueSeries { workerId: string; pool: string; pending: number[]; }
/** Raw per-worker scheduler queues. Pool and cluster totals are derived so every
 *  scope is mathematically consistent with these leaf series. */
export interface PendingQueue { t_ms: number[]; series: PendingQueueSeries[]; }
export interface Payloads {
  slo: Slo;
  throughput: Throughput;
  utilization: UtilSeries;
  kv: KvSeries;
  concurrency?: Concurrency;
  pendingQueue?: PendingQueue;
}

// ---- topology types --------------------------------------------------------
export interface Arch { type: string; model: string; params: Record<string, number | string>; }
export interface WorkerCfg { type: string; memGb: number; mult: number; }
export interface WorkerInstance { id: string; gpus: number[]; dp?: number; }
export interface Group { gpu: string; replicas: number; gpusPerReplica: number; numGpus: number; arch: Arch; worker: WorkerCfg; workers: WorkerInstance[]; }
export interface Pool { role: string; placement: string; groups: Group[]; }
export interface Topology { pools: Pool[]; }

export interface Summary { total_tok_s: number; num_gpus: number; requests: number; ttft_p50: number; tpot_p50: number; e2e_p50: number; }
export interface WorkerRow {
  id: string; pool: string; workerType: string; archType: string; gpu: string;
  gpuCount: number; gpus: number[]; dp: number | null; arch: Arch; worker: WorkerCfg; tree: CostNode;
}
export interface Run {
  id: string; name: string; model: string; deployment: 'unified' | 'afd'; gpu: string;
  summary: Summary; topology: Topology; trees: Record<string, CostNode>; payloads: Payloads;
  workerList: WorkerRow[]; gpuTotal: number;
}

// ---- seeded RNG ------------------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function cdf(rand: () => number, median: number, sigma: number, n = 260, points = 120): Omit<SloMetric, 'label' | 'unit'> {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(1e-6, rand()); const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    xs.push(median * Math.exp(sigma * z));
  }
  xs.sort((a, b) => a - b);
  const pick = (q: number) => xs[Math.min(n - 1, Math.floor(q * n))];
  const x: number[] = []; const y: number[] = [];
  for (let i = 0; i < points; i++) {
    const idx = Math.floor((i / (points - 1)) * (n - 1));
    x.push(+xs[idx].toFixed(3)); y.push(+(((idx + 1) / n) * 100).toFixed(2));
  }
  return { x, y_pct: y, markers: { p50: +pick(0.5).toFixed(2), p90: +pick(0.9).toFixed(2), p99: +pick(0.99).toFixed(2) } };
}

function throughputOf(seed: number, tps: number, spanMs: number): Throughput {
  const rand = rng(seed + 7); const n = 64;
  const t0: number[] = []; const t1: number[] = []; const total: number[] = []; const prefill: number[] = []; const decode: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1); const ramp = Math.min(1, f * 4);
    const wobble = 1 + 0.1 * Math.sin(f * 9) + (rand() - 0.5) * 0.08;
    const tot = tps * ramp * wobble;
    const pf = tot * (0.5 + (rand() - 0.5) * 0.06);
    t0.push(+(f * spanMs).toFixed(0)); t1.push(+(((i + 1) / n) * spanMs).toFixed(0));
    total.push(+tot.toFixed(0)); prefill.push(+pf.toFixed(0)); decode.push(+(tot - pf).toFixed(0));
  }
  return { t_start_ms: t0, t_end_ms: t1, total, prefill, decode };
}

/** Active requests in the system over wall-clock: fill the pipe, hold a steady
 *  in-flight concurrency, drain at the tail. `peak` is passed in (Little's law
 *  estimate from throughput × mean E2E), so the curve is dimensioned per run. */
function concurrencyOf(seed: number, peak: number, spanMs: number): Concurrency {
  const rand = rng(seed + 13); const n = 64;
  const t: number[] = []; const active: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const ramp = Math.min(1, f * 3.5);                       // admit until the system fills
    const drain = f > 0.9 ? Math.max(0, (1 - f) / 0.1) : 1;  // empty out at the very end
    const wob = 1 + 0.06 * Math.sin(f * 13) + (rand() - 0.5) * 0.09;
    t.push(+(((i + 0.5) / n) * spanMs).toFixed(0));
    active.push(Math.max(0, Math.round(peak * ramp * drain * wob)));
  }
  return { t_ms: t, active, peak };
}

function gaussian(value: number, center: number, width: number): number {
  return Math.exp(-0.5 * Math.pow((value - center) / width, 2));
}

/** Deterministic queue pressure with short bursts and a final drain. The fake
 *  payload stays at worker granularity; scoped totals are produced in store.ts. */
function pendingQueueOf(seed: number, run: Run, spanMs: number): PendingQueue {
  const sampleCount = 64;
  const tMs = Array.from({ length: sampleCount }, (_, index) =>
    +(((index + 0.5) / sampleCount) * spanMs).toFixed(0));
  const requestsPerWorker = run.summary.requests / Math.max(1, run.workerList.length);

  const series = run.workerList.map((worker, workerIndex) => {
    const random = rng(seed * 101 + workerIndex * 29 + 17);
    const roleScale = worker.pool === 'ffn' ? 0.25 : worker.pool === 'attn' ? 0.13 : 0.16;
    const targetPeak = Math.max(5, Math.round(requestsPerWorker * roleScale * (0.88 + random() * 0.24)));
    const centers = [0.2 + random() * 0.04, 0.5 + random() * 0.05, 0.76 + random() * 0.05];
    const pending = tMs.map((_, index) => {
      const fraction = (index + 0.5) / sampleCount;
      const fill = Math.min(1, fraction / 0.08);
      const drain = fraction > 0.92 ? Math.max(0, (1 - fraction) / 0.08) : 1;
      const burstPressure =
        0.12
        + 0.68 * gaussian(fraction, centers[0], 0.035)
        + 0.92 * gaussian(fraction, centers[1], 0.05)
        + 0.76 * gaussian(fraction, centers[2], 0.042);
      const jitter = 0.9 + random() * 0.2;
      return Math.max(0, Math.round(targetPeak * Math.min(1, burstPressure) * fill * drain * jitter));
    });
    return { workerId: worker.id, pool: worker.pool, pending };
  });

  return { t_ms: tMs, series };
}

function utilSeries(rand: () => number, pools: { key: string; label: string; avg: number }[], spanMs: number): UtilSeries {
  const n = 64; const t: number[] = [];
  for (let i = 0; i < n; i++) t.push(+(((i + 0.5) / n) * spanMs).toFixed(0));
  return {
    t_ms: t,
    series: pools.map((p) => ({
      key: p.key, label: p.label,
      util: t.map((_, i) => {
        const f = i / (n - 1); const ramp = Math.min(1, f * 3);
        return +Math.min(0.99, Math.max(0, p.avg * ramp * (1 + (rand() - 0.5) * 0.12))).toFixed(3);
      }),
    })),
  };
}

function kvSeries(rand: () => number, pools: { label: string; cap: number; peak: number }[], spanMs: number): KvSeries {
  const n = 64; const t: number[] = [];
  for (let i = 0; i < n; i++) t.push(+(((i + 0.5) / n) * spanMs).toFixed(0));
  return {
    t_ms: t,
    series: pools.map((p) => ({
      label: p.label, capacity: p.cap,
      active: t.map((_, i) => {
        const f = i / (n - 1);
        const fill = p.cap * Math.min(p.peak, p.peak * Math.min(1, f * 2.5)) * (1 + (rand() - 0.5) * 0.06);
        return Math.round(Math.max(0, fill));
      }),
    })),
  };
}

// ---- cost trees ------------------------------------------------------------
const H200 = 'NVIDIA H200';
const LLAMA_MODEL_PARAMS = {
  parameters: '8B', active_parameters: '8B', context_length: '128K',
  attention_heads: 32, kv_heads: 8,
};
const QWEN_MODEL_PARAMS = {
  parameters: '235B', active_parameters: '22B', context_length: '128K',
  hidden: 4096, attention_heads: 64, kv_heads: 4,
};

const denseLayer = () =>
  sum('decoder layer',
    sum('attn_block (Local)',
      leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0055),
      leaf('qkv_proj', 'single_gemm', 'n=6144 k=4096', 0.021),
      max('attn', 1.0,
        leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=32 kv=8 hd=128', 0.038),
        leaf('attn.decode', 'flashinfer_attn_decode', 'qo=32 kv=8 hd=128', 0.016)),
      leaf('o_proj', 'single_gemm', 'n=4096 k=4096', 0.015)),
    sum('ffn (Local)',
      leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0055),
      leaf('up_gate_proj', 'single_gemm', 'n=28672 k=4096', 0.06),
      leaf('activation', 'elementwise', 'silu·mul', 0.004),
      leaf('down_proj', 'single_gemm', 'n=4096 k=14336', 0.054)));

const denseTree = () =>
  annotate(sum('llama3_dense',
    leaf('embedding', 'elementwise', 'vocab=128256', 0.003),
    scale('decoder × 32 layers', 32, denseLayer()),
    leaf('final_norm', 'rms_norm', 'hidden=4096', 0.005),
    leaf('lm_head', 'single_gemm', 'n=128256 k=4096', 0.18)));

const moeLayer = () =>
  sum('MoE decoder layer',
    sum('attn_block (TP=4)',
      leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0048),
      leaf('qkv_proj', 'single_gemm', 'n=2304 k=4096', 0.011),
      max('attn', 1.0,
        leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=16 kv=1 hd=128', 0.03),
        leaf('attn.decode', 'flashinfer_attn_decode', 'qo=16 kv=1 hd=128', 0.012)),
      leaf('o_proj', 'single_gemm', 'n=4096 k=2048', 0.0085),
      leaf('tp_allreduce', 'all_reduce', 'num_gpus=4 fabric=NVLink', 0.014)),
    sum('moe_ffn (EP=32)',
      leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0048),
      leaf('router', 'moe_router', 'experts=128 top_k=8', 0.006),
      leaf('dispatch', 'p2p_inter', 'ep=32 nvl=8', 0.023),
      scale('experts × 4 / gpu', 4, leaf('grouped_gemm', 'grouped_gemm', 'm_inter=3072 fp8', 0.029)),
      leaf('combine', 'p2p_inter', 'ep=32 nvl=8', 0.021)));

const moeTree = () =>
  annotate(sum('qwen3_moe_dp_attn_ep_ffn',
    leaf('embedding', 'elementwise', 'vocab=151936', 0.003),
    scale('decoder × 94 layers', 94, moeLayer()),
    leaf('final_norm', 'rms_norm', 'hidden=4096', 0.005),
    leaf('lm_head', 'single_gemm', 'n=151936 k=4096', 0.21)));

const afdAttnTree = () =>
  annotate(sum('qwen3_attn_tp (AFD attn worker)',
    leaf('embedding', 'elementwise', 'vocab=151936', 0.003),
    scale('attn × 94 layers', 94,
      sum('attn_block (TP=4)',
        leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0048),
        leaf('qkv_proj', 'single_gemm', 'n=2304 k=4096', 0.011),
        max('attn', 1.0,
          leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=16 kv=1 hd=128', 0.03),
          leaf('attn.decode', 'flashinfer_attn_decode', 'qo=16 kv=1 hd=128', 0.012)),
        leaf('o_proj', 'single_gemm', 'n=4096 k=2048', 0.0085),
        leaf('tp_allreduce', 'all_reduce', 'num_gpus=4', 0.014),
        leaf('scatter_to_ffn', 'p2p_inter', 'attn→ffn tokens', 0.018)))));

const afdFfnTree = () =>
  annotate(sum('qwen3_ffn_moe (AFD ffn worker)',
    scale('moe × 94 layers', 94,
      sum('moe_ffn (EP=32)',
        leaf('gather_from_attn', 'p2p_inter', 'attn→ffn tokens', 0.018),
        leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0048),
        leaf('router', 'moe_router', 'experts=128 top_k=8', 0.006),
        leaf('dispatch', 'p2p_intra', 'ep=32 nvl=8', 0.018),
        scale('experts × 4 / gpu', 4, leaf('grouped_gemm', 'grouped_gemm', 'm_inter=3072 fp8', 0.029)),
        leaf('combine', 'p2p_intra', 'ep=32 nvl=8', 0.017)))));

// ---- runs ------------------------------------------------------------------
const denseT = denseTree();
const moeT = moeTree();
const attnT = afdAttnTree();
const ffnT = afdFfnTree();

const rawRuns: Run[] = [
  {
    id: '20260713_llama3_8b_unified', name: 'Llama-3 8B · unified', model: 'Llama-3-8B (dense)',
    deployment: 'unified', gpu: H200,
    summary: { total_tok_s: 13825, num_gpus: 1, requests: 300, ttft_p50: 22.2, tpot_p50: 8.9, e2e_p50: 4393 },
    topology: {
      pools: [{
        role: 'main', placement: 'least-queued',
        groups: [{
          gpu: H200, replicas: 1, gpusPerReplica: 1, numGpus: 1,
          arch: { type: 'llama3_dense', model: 'llama3_8b.json', params: { ...LLAMA_MODEL_PARAMS, layers: 32, hidden: 4096, dtype: 'bf16' } },
          worker: { type: 'barebone', memGb: 109.3, mult: 1.09 },
          workers: [{ id: 'main-0', gpus: [0] }],
        }],
      }],
    },
    trees: { 'main-0': denseT },
    payloads: {
      slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(11), 22, 0.4) }, tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(12), 8.9, 0.12) }, e2e: { label: 'E2E', unit: 'ms', ...cdf(rng(13), 4400, 0.22) } },
      throughput: throughputOf(101, 13825, 22000),
      utilization: utilSeries(rng(21), [{ key: 'main', label: 'main', avg: 0.86 }], 22000),
      kv: kvSeries(rng(31), [{ label: 'main', cap: 900000, peak: 0.62 }], 22000),
    },
    workerList: [], gpuTotal: 0,
  },
  {
    id: '20260530_qwen3_235b_ep32', name: 'Qwen3 235B · unified MoE (EP=32)', model: 'Qwen3-235B-A22B (MoE)',
    deployment: 'unified', gpu: H200,
    summary: { total_tok_s: 41980, num_gpus: 32, requests: 1000, ttft_p50: 48.0, tpot_p50: 11.0, e2e_p50: 5200 },
    topology: {
      pools: [{
        role: 'main', placement: 'least-queued',
        groups: [{
          gpu: H200, replicas: 1, gpusPerReplica: 32, numGpus: 32,
          arch: { type: 'qwen3_moe_dp_attn_ep_ffn', model: 'qwen3_235b.json', params: { ...QWEN_MODEL_PARAMS, layers: 94, attn_tp: 4, ep: 32, hp: 1, nvl: 8, dp_groups: 8, experts: 128, top_k: 8, dtype: 'fp8' } },
          worker: { type: 'hp_unified', memGb: 140, mult: 1.11 },
          workers: [{ id: 'main-0', gpus: Array.from({ length: 32 }, (_, i) => i), dp: 8 }],
        }],
      }],
    },
    trees: { 'main-0': moeT },
    payloads: {
      slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(14), 48, 0.5) }, tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(15), 11, 0.15) }, e2e: { label: 'E2E', unit: 'ms', ...cdf(rng(16), 5200, 0.28) } },
      throughput: throughputOf(102, 41980, 60000),
      utilization: utilSeries(rng(22), [{ key: 'main', label: 'main (attn+ffn)', avg: 0.78 }], 60000),
      kv: kvSeries(rng(32), [{ label: 'main', cap: 6400000, peak: 0.7 }], 60000),
    },
    workerList: [], gpuTotal: 0,
  },
  {
    id: '20260704_afd_qwen3_235b', name: 'Qwen3 235B · AFD (attn ∥ ffn)', model: 'Qwen3-235B-A22B (MoE, disaggregated)',
    deployment: 'afd', gpu: H200,
    summary: { total_tok_s: 46110, num_gpus: 40, requests: 1000, ttft_p50: 44.0, tpot_p50: 10.2, e2e_p50: 4950 },
    topology: {
      pools: [
        {
          role: 'attn', placement: 'least-queued',
          groups: [{
            gpu: H200, replicas: 2, gpusPerReplica: 4, numGpus: 8,
            arch: { type: 'qwen3_attn_tp', model: 'qwen3_235b.json', params: { ...QWEN_MODEL_PARAMS, layers: 94, attn_tp: 4, dtype: 'bf16' } },
            worker: { type: 'disagg_attn', memGb: 80, mult: 1.0 },
            workers: [{ id: 'attn-0', gpus: [0, 1, 2, 3] }, { id: 'attn-1', gpus: [4, 5, 6, 7] }],
          }],
        },
        {
          role: 'ffn', placement: 'least-queued',
          groups: [{
            gpu: H200, replicas: 1, gpusPerReplica: 32, numGpus: 32,
            arch: { type: 'qwen3_ffn_moe', model: 'qwen3_235b.json', params: { ...QWEN_MODEL_PARAMS, layers: 94, attn_tp: 4, ep: 32, nvl: 8, experts: 128, top_k: 8, dtype: 'fp8' } },
            worker: { type: 'disagg_ffn', memGb: 140, mult: 1.05 },
            workers: [{ id: 'ffn-0', gpus: Array.from({ length: 32 }, (_, i) => 8 + i) }],
          }],
        },
      ],
    },
    trees: { 'attn-0': attnT, 'attn-1': attnT, 'ffn-0': ffnT },
    payloads: {
      slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(17), 44, 0.48) }, tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(18), 10.2, 0.14) }, e2e: { label: 'E2E', unit: 'ms', ...cdf(rng(19), 4950, 0.26) } },
      throughput: throughputOf(103, 46110, 60000),
      utilization: utilSeries(rng(23), [{ key: 'attn', label: 'attn pool', avg: 0.72 }, { key: 'ffn', label: 'ffn pool', avg: 0.83 }], 60000),
      kv: kvSeries(rng(33), [{ label: 'attn', cap: 1600000, peak: 0.66 }], 60000),
    },
    workerList: [], gpuTotal: 0,
  },
];

// derive flat worker list + gpu totals
rawRuns.forEach((run, i) => {
  const wl: WorkerRow[] = [];
  run.topology.pools.forEach((pool) => {
    pool.groups.forEach((grp) => {
      grp.workers.forEach((w) => {
        wl.push({
          id: w.id, pool: pool.role, workerType: grp.worker.type, archType: grp.arch.type,
          gpu: grp.gpu, gpuCount: w.gpus.length, gpus: w.gpus, dp: w.dp ?? null,
          arch: grp.arch, worker: grp.worker, tree: run.trees[w.id],
        });
      });
    });
  });
  run.workerList = wl;
  run.gpuTotal = run.topology.pools.reduce((a, p) => a + p.groups.reduce((b, gr) => b + gr.numGpus, 0), 0);

  // active in-flight requests ≈ (req/s) × mean E2E  [Little's law], req ≈ 992 tok
  const tp = run.payloads.throughput;
  const span = tp.t_end_ms[tp.t_end_ms.length - 1] || 1;
  const reqPerS = run.summary.total_tok_s / 992;
  const peak = Math.max(1, Math.round(reqPerS * (run.summary.e2e_p50 / 1000)));
  run.payloads.concurrency = concurrencyOf(i + 1, peak, span);
  run.payloads.pendingQueue = pendingQueueOf(i + 1, run, span);
});

export const RUNS: Run[] = rawRuns;
