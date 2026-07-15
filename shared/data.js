/*
 * data.js — deterministic fake VibeSim runs (global `VIZ`)
 *
 * Mirrors the real artifact shapes so a backend can later swap in:
 *   - topology: deployment → pools → groups → workers  (from run_meta.json + preset)
 *   - per-worker cost tree: Sum/Max/Scale/Leaf          (from cost_manifest/*.json)
 *   - payloads: SLO CDF, throughput, utilization, KV, kernel-share (from analyzer payloads/)
 *
 * No network, no build. Requires tree.js loaded first.
 */
(function () {
  const T = window.Tree;

  // seeded RNG so charts are stable across reloads
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  // ---- payload synthesis ---------------------------------------------------
  function cdf(rand, median, sigma, n = 260, points = 120) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const u1 = Math.max(1e-6, rand()), u2 = rand();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      xs.push(median * Math.exp(sigma * z));
    }
    xs.sort((a, b) => a - b);
    const pick = (q) => xs[Math.min(n - 1, Math.floor(q * n))];
    const x = [], y = [];
    for (let i = 0; i < points; i++) {
      const idx = Math.floor((i / (points - 1)) * (n - 1));
      x.push(+xs[idx].toFixed(3)); y.push(+(((idx + 1) / n) * 100).toFixed(2));
    }
    return { x, y_pct: y, markers: { p50: +pick(0.5).toFixed(2), p90: +pick(0.9).toFixed(2), p99: +pick(0.99).toFixed(2) } };
  }

  function timeseries(rand, spanMs, opts) {
    const n = 64, t0 = [], t1 = [], total = [], prefill = [], decode = [];
    const base = opts.base, split = opts.prefillFrac;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const ramp = Math.min(1, f * 4);                 // warmup
      const wobble = 1 + 0.10 * Math.sin(f * 9) + (rand() - 0.5) * 0.08;
      const tot = base * ramp * wobble;
      const pf = tot * (split + (rand() - 0.5) * 0.06);
      t0.push(+(f * spanMs).toFixed(0)); t1.push(+(((i + 1) / n) * spanMs).toFixed(0));
      total.push(+tot.toFixed(0)); prefill.push(+pf.toFixed(0)); decode.push(+(tot - pf).toFixed(0));
    }
    return { t_start_ms: t0, t_end_ms: t1, total, prefill, decode };
  }

  function utilSeries(rand, pools, spanMs) {
    const n = 64, t = [];
    for (let i = 0; i < n; i++) t.push(+(((i + 0.5) / n) * spanMs).toFixed(0));
    return {
      t_ms: t,
      series: pools.map((p, k) => ({
        key: p.key, label: p.label,
        util: t.map((_, i) => {
          const f = i / (n - 1), ramp = Math.min(1, f * 3);
          return +Math.min(0.99, Math.max(0, (p.avg * ramp) * (1 + (rand() - 0.5) * 0.12))).toFixed(3);
        }),
      })),
    };
  }

  function kvSeries(rand, pools, spanMs) {
    const n = 64, t = [];
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

  function payloads(seed, cfg) {
    const r = rng(seed);
    return {
      slo: {
        ttft: { label: 'TTFT', unit: 'ms', ...cdf(r, cfg.ttft, 0.45) },
        tpot: { label: 'TPOT', unit: 'ms', ...cdf(r, cfg.tpot, 0.18) },
        e2e:  { label: 'E2E',  unit: 'ms', ...cdf(r, cfg.e2e, 0.30) },
      },
      throughput: timeseries(r, cfg.span, { base: cfg.tps / 64 * 1.0 * (cfg.span / 1000) / (cfg.span / 1000), prefillFrac: 0.5 }),
      utilization: utilSeries(r, cfg.utilPools, cfg.span),
      kv: kvSeries(r, cfg.kvPools, cfg.span),
    };
  }
  // note: throughput base is just cfg.tps scaled; simplify:
  function throughputOf(seed, tps, span) {
    return timeseries(rng(seed + 7), span, { base: tps, prefillFrac: 0.5 });
  }

  // ---- cost trees ----------------------------------------------------------
  const g = 'NVIDIA H200';

  function denseLayer() {
    return T.sum('decoder layer',
      T.sum('attn_block (Local)',
        T.leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0055),
        T.leaf('qkv_proj', 'single_gemm', 'n=6144 k=4096', 0.0210),
        T.max('attn', 1.0,
          T.leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=32 kv=8 hd=128', 0.0380),
          T.leaf('attn.decode', 'flashinfer_attn_decode', 'qo=32 kv=8 hd=128', 0.0160)),
        T.leaf('o_proj', 'single_gemm', 'n=4096 k=4096', 0.0150)),
      T.sum('ffn (Local)',
        T.leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0055),
        T.leaf('up_gate_proj', 'single_gemm', 'n=28672 k=4096', 0.0600),
        T.leaf('activation', 'elementwise', 'silu·mul', 0.0040),
        T.leaf('down_proj', 'single_gemm', 'n=4096 k=14336', 0.0540)));
  }
  function denseTree() {
    return T.annotate(T.sum('llama3_dense',
      T.leaf('embedding', 'elementwise', 'vocab=128256', 0.0030),
      T.scale('decoder × 32 layers', 32, denseLayer()),
      T.leaf('final_norm', 'rms_norm', 'hidden=4096', 0.0050),
      T.leaf('lm_head', 'single_gemm', 'n=128256 k=4096', 0.1800)));
  }

  function moeLayer() {
    return T.sum('MoE decoder layer',
      T.sum('attn_block (TP=4)',
        T.leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0048),
        T.leaf('qkv_proj', 'single_gemm', 'n=2304 k=4096', 0.0110),
        T.max('attn', 1.0,
          T.leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=16 kv=1 hd=128', 0.0300),
          T.leaf('attn.decode', 'flashinfer_attn_decode', 'qo=16 kv=1 hd=128', 0.0120)),
        T.leaf('o_proj', 'single_gemm', 'n=4096 k=2048', 0.0085),
        T.leaf('tp_allreduce', 'all_reduce', 'num_gpus=4 fabric=NVLink', 0.0140)),
      T.sum('moe_ffn (EP=32)',
        T.leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0048),
        T.leaf('router', 'moe_router', 'experts=128 top_k=8', 0.0060),
        T.leaf('dispatch', 'p2p_inter', 'ep=32 nvl=8', 0.0230),
        T.scale('experts × 4 / gpu', 4, T.leaf('grouped_gemm', 'grouped_gemm', 'm_inter=3072 fp8', 0.0290)),
        T.leaf('combine', 'p2p_inter', 'ep=32 nvl=8', 0.0210)));
  }
  function moeTree() {
    return T.annotate(T.sum('qwen3_moe_dp_attn_ep_ffn',
      T.leaf('embedding', 'elementwise', 'vocab=151936', 0.0030),
      T.scale('decoder × 94 layers', 94, moeLayer()),
      T.leaf('final_norm', 'rms_norm', 'hidden=4096', 0.0050),
      T.leaf('lm_head', 'single_gemm', 'n=151936 k=4096', 0.2100)));
  }

  function afdAttnTree() {
    return T.annotate(T.sum('qwen3_attn_tp (AFD attn worker)',
      T.leaf('embedding', 'elementwise', 'vocab=151936', 0.0030),
      T.scale('attn × 94 layers', 94,
        T.sum('attn_block (TP=4)',
          T.leaf('input_norm', 'rms_norm', 'hidden=4096', 0.0048),
          T.leaf('qkv_proj', 'single_gemm', 'n=2304 k=4096', 0.0110),
          T.max('attn', 1.0,
            T.leaf('attn.prefill', 'flashinfer_attn_prefill', 'qo=16 kv=1 hd=128', 0.0300),
            T.leaf('attn.decode', 'flashinfer_attn_decode', 'qo=16 kv=1 hd=128', 0.0120)),
          T.leaf('o_proj', 'single_gemm', 'n=4096 k=2048', 0.0085),
          T.leaf('tp_allreduce', 'all_reduce', 'num_gpus=4', 0.0140),
          T.leaf('scatter_to_ffn', 'p2p_inter', 'attn→ffn tokens', 0.0180)))));
  }
  function afdFfnTree() {
    return T.annotate(T.sum('qwen3_ffn_moe (AFD ffn worker)',
      T.scale('moe × 94 layers', 94,
        T.sum('moe_ffn (EP=32)',
          T.leaf('gather_from_attn', 'p2p_inter', 'attn→ffn tokens', 0.0180),
          T.leaf('post_norm', 'rms_norm', 'hidden=4096', 0.0048),
          T.leaf('router', 'moe_router', 'experts=128 top_k=8', 0.0060),
          T.leaf('dispatch', 'p2p_intra', 'ep=32 nvl=8', 0.0180),
          T.scale('experts × 4 / gpu', 4, T.leaf('grouped_gemm', 'grouped_gemm', 'm_inter=3072 fp8', 0.0290)),
          T.leaf('combine', 'p2p_intra', 'ep=32 nvl=8', 0.0170)))));
  }

  // ---- runs ----------------------------------------------------------------
  const denseT = denseTree();
  const moeT = moeTree();
  const attnT = afdAttnTree();
  const ffnT = afdFfnTree();

  const runs = [
    {
      id: '20260713_llama3_8b_unified',
      name: 'Llama-3 8B · unified',
      model: 'Llama-3-8B (dense)',
      deployment: 'unified',
      gpu: g,
      summary: { total_tok_s: 13825, num_gpus: 1, requests: 300,
        ttft_p50: 22.2, tpot_p50: 8.9, e2e_p50: 4393 },
      topology: {
        pools: [{
          role: 'main', placement: 'least-queued',
          groups: [{
            gpu: g, replicas: 1, gpusPerReplica: 1, numGpus: 1,
            arch: { type: 'llama3_dense', model: 'llama3_8b.json',
              params: { layers: 32, hidden: 4096, dtype: 'bf16' } },
            worker: { type: 'barebone', memGb: 109.3, mult: 1.09 },
            workers: [{ id: 'main-0', gpus: [0] }],
          }],
        }],
      },
      trees: { 'main-0': denseT },
      payloads: {
        slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(11), 22, 0.4) },
               tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(12), 8.9, 0.12) },
               e2e:  { label: 'E2E',  unit: 'ms', ...cdf(rng(13), 4400, 0.22) } },
        throughput: throughputOf(101, 13825, 22000),
        utilization: utilSeries(rng(21), [{ key: 'main', label: 'main', avg: 0.86 }], 22000),
        kv: kvSeries(rng(31), [{ label: 'main', cap: 900000, peak: 0.62 }], 22000),
        kernel: T.leafTotals(denseT),
      },
    },
    {
      id: '20260530_qwen3_235b_ep32',
      name: 'Qwen3 235B · unified MoE (EP=32)',
      model: 'Qwen3-235B-A22B (MoE)',
      deployment: 'unified',
      gpu: g,
      summary: { total_tok_s: 41980, num_gpus: 32, requests: 1000,
        ttft_p50: 48.0, tpot_p50: 11.0, e2e_p50: 5200 },
      topology: {
        pools: [{
          role: 'main', placement: 'least-queued',
          groups: [{
            gpu: g, replicas: 1, gpusPerReplica: 32, numGpus: 32,
            arch: { type: 'qwen3_moe_dp_attn_ep_ffn', model: 'qwen3_235b.json',
              params: { layers: 94, attn_tp: 4, ep: 32, hp: 1, nvl: 8, dp_groups: 8, experts: 128, top_k: 8, dtype: 'fp8' } },
            worker: { type: 'hp_unified', memGb: 140, mult: 1.11 },
            workers: [{ id: 'main-0', gpus: Array.from({ length: 32 }, (_, i) => i), dp: 8 }],
          }],
        }],
      },
      trees: { 'main-0': moeT },
      payloads: {
        slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(14), 48, 0.5) },
               tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(15), 11, 0.15) },
               e2e:  { label: 'E2E',  unit: 'ms', ...cdf(rng(16), 5200, 0.28) } },
        throughput: throughputOf(102, 41980, 60000),
        utilization: utilSeries(rng(22), [{ key: 'main', label: 'main (attn+ffn)', avg: 0.78 }], 60000),
        kv: kvSeries(rng(32), [{ label: 'main', cap: 6400000, peak: 0.7 }], 60000),
        kernel: T.leafTotals(moeT),
      },
    },
    {
      id: '20260704_afd_qwen3_235b',
      name: 'Qwen3 235B · AFD (attn ∥ ffn)',
      model: 'Qwen3-235B-A22B (MoE, disaggregated)',
      deployment: 'afd',
      gpu: g,
      summary: { total_tok_s: 46110, num_gpus: 40, requests: 1000,
        ttft_p50: 44.0, tpot_p50: 10.2, e2e_p50: 4950 },
      topology: {
        pools: [
          {
            role: 'attn', placement: 'least-queued',
            groups: [{
              gpu: g, replicas: 2, gpusPerReplica: 4, numGpus: 8,
              arch: { type: 'qwen3_attn_tp', model: 'qwen3_235b.json',
                params: { layers: 94, attn_tp: 4, dtype: 'bf16' } },
              worker: { type: 'disagg_attn', memGb: 80, mult: 1.0 },
              workers: [{ id: 'attn-0', gpus: [0, 1, 2, 3] }, { id: 'attn-1', gpus: [4, 5, 6, 7] }],
            }],
          },
          {
            role: 'ffn', placement: 'least-queued',
            groups: [{
              gpu: g, replicas: 1, gpusPerReplica: 32, numGpus: 32,
              arch: { type: 'qwen3_ffn_moe', model: 'qwen3_235b.json',
                params: { layers: 94, attn_tp: 4, ep: 32, nvl: 8, experts: 128, top_k: 8, dtype: 'fp8' } },
              worker: { type: 'disagg_ffn', memGb: 140, mult: 1.05 },
              workers: [{ id: 'ffn-0', gpus: Array.from({ length: 32 }, (_, i) => 8 + i) }],
            }],
          },
        ],
      },
      trees: { 'attn-0': attnT, 'attn-1': attnT, 'ffn-0': ffnT },
      payloads: {
        slo: { ttft: { label: 'TTFT', unit: 'ms', ...cdf(rng(17), 44, 0.48) },
               tpot: { label: 'TPOT', unit: 'ms', ...cdf(rng(18), 10.2, 0.14) },
               e2e:  { label: 'E2E',  unit: 'ms', ...cdf(rng(19), 4950, 0.26) } },
        throughput: throughputOf(103, 46110, 60000),
        utilization: utilSeries(rng(23), [
          { key: 'attn', label: 'attn pool', avg: 0.72 },
          { key: 'ffn', label: 'ffn pool', avg: 0.83 }], 60000),
        kv: kvSeries(rng(33), [{ label: 'attn', cap: 1600000, peak: 0.66 }], 60000),
        kernel: T.leafTotals(ffnT),
      },
    },
  ];

  // flat worker list per run (for the topology → worker → arch navigation)
  runs.forEach((run) => {
    run.workerList = [];
    run.topology.pools.forEach((pool) => {
      pool.groups.forEach((grp) => {
        grp.workers.forEach((w) => {
          run.workerList.push({
            id: w.id, pool: pool.role, workerType: grp.worker.type,
            archType: grp.arch.type, gpu: grp.gpu, gpuCount: w.gpus.length,
            gpus: w.gpus, dp: w.dp || null, arch: grp.arch, worker: grp.worker,
            tree: run.trees[w.id],
          });
        });
      });
    });
    run.gpuTotal = run.topology.pools.reduce((a, p) =>
      a + p.groups.reduce((b, gr) => b + gr.numGpus, 0), 0);
  });

  window.VIZ = { runs };
})();
