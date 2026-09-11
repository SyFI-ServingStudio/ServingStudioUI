/**
 * The documents a run's page reads, as the Analyzer serves them.
 *
 * Shared because several specs need them for different reasons: the headline
 * spec asserts on them, the drill-down specs navigate through them, and the chat
 * spec needs the page underneath the dock to render quietly. Copying them would
 * let the copies drift, and then one spec would be testing a shape the service
 * does not send.
 *
 * ## One run, not several
 *
 * Every document here describes the *same* deployment: two pools of two
 * single-GPU workers, four GPUs, 512 requests, 512.2 s of simulated time. That
 * is not decoration. Six specs now read this fixture and a reader debugging one
 * of them has to be able to carry a number from one panel to another — if the
 * summary said one GPU while the topology drew four, every cross-panel
 * discrepancy would be ambiguous between fixture history and a real defect.
 *
 * Where a quantity is derived, it is written as the derivation (`TOTAL_TOK_S /
 * GPUS`) rather than as a number, so the two cannot come apart.
 */

/** The deployment every document below describes. */
const GPUS = 4;
const REQUESTS = 512;
/** Simulated milliseconds, and the window every binned analysis is taken over. */
const SIM_MS = 512231.1;
const BINS = 200;
const TOTAL_TOK_S = (131072 + 524288) / (SIM_MS / 1000);
import type { Page } from '@playwright/test';

const DECODE_TOKENS = 131072;
const PREFILL_TOKENS = 524288;
/** How long the simulation itself took to run, as the launcher measured it. */
const WALL_S = 0.206599802;

/** A per-second rate over the run's own simulated span. */
function perSecond(total: number): number {
  return total / (SIM_MS / 1000);
}

/**
 * As served by `runs/{id}/subjects/summary/report`.
 *
 * Every rate is the division that produced it. Written as literals these agreed
 * with the counts beside them only for as long as nobody edited the counts —
 * and a fixture whose throughput no longer follows from its token totals is one
 * where a panel showing the wrong figure looks correct.
 */
export const RUN_SUMMARY = {
  cause: 'DrainComplete',
  completed_req_s: perSecond(REQUESTS),
  decode_tok_s: perSecond(DECODE_TOKENS),
  decode_tokens: DECODE_TOKENS,
  num_gpus: GPUS,
  prefill_tok_s: perSecond(PREFILL_TOKENS),
  prefill_tokens: PREFILL_TOKENS,
  // How many times faster than real time the simulation ran.
  realtime_x: SIM_MS / 1000 / WALL_S,
  requests_finished: REQUESTS,
  requests_total: REQUESTS,
  sim_ms: SIM_MS,
  total_tok_s: TOTAL_TOK_S,
  total_tok_s_per_gpu: TOTAL_TOK_S / GPUS,
  total_tokens: DECODE_TOKENS + PREFILL_TOKENS,
  wall_s: WALL_S,
};

/** The bounded concurrency backdrop shown beneath the system map. */
export const RUN_CONCURRENCY = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    request_count: REQUESTS,
    span_ms: SIM_MS,
    bins: 4,
    max_points: 512,
    aggregation: 'equal-width time-weighted mean',
  },
  t_ms: [SIM_MS / 4, SIM_MS / 2, (SIM_MS * 3) / 4, SIM_MS],
  active: [4, 16, 12, 2],
  peak: 24,
  definitions: {
    scope: 'run',
    active: 'time-weighted mean active requests',
    t_ms: 'right edge of each bucket in milliseconds',
    peak: 'exact event-sweep peak',
    binning: 'equal-width bins',
  },
};

/**
 * A percentile of a sorted sample, as `cdf.rs::percentile_sorted` computes one.
 *
 * Linear interpolation at rank `q × (n − 1)`, not the nearest rank. The two
 * agree to within a sample's spacing, which is exactly why the difference has to
 * be written out: on a 512-point curve they differ in the third decimal, both
 * round to the same figure on screen, and a fixture built the other way would
 * quietly certify a marker the Analyzer would never emit.
 */
function percentile(sorted: readonly number[], quantile: number): number {
  const rank = quantile * (sorted.length - 1);
  const below = Math.floor(rank);
  const above = Math.ceil(rank);
  if (below === above) return sorted[below];
  return sorted[below] * (above - rank) + sorted[above] * (rank - below);
}

/**
 * One latency series, as the CDF producer emits one.
 *
 * The markers are *read off* the curve rather than stated beside it, and the
 * curve has one point per request because 512 is under the producer's
 * thousand-point cap. Written the other way round — a two-point curve with
 * hand-picked percentiles — the fixture claimed a p99 above its own largest
 * sample. Nothing in this build reads the arrays today, which is exactly why
 * they were wrong, and why whatever draws them next would have inherited it.
 */
function cdf(key: string, label: string, unit: string, fastest: number, slowest: number) {
  const x = Array.from(
    { length: REQUESTS },
    (_, at) => fastest + ((slowest - fastest) * at) / (REQUESTS - 1),
  );
  return {
    key,
    label,
    unit,
    n: REQUESTS,
    markers: { p50: percentile(x, 0.5), p90: percentile(x, 0.9), p99: percentile(x, 0.99) },
    x,
    // `y_pct`, not `y`, and it runs to 100 rather than to 1 — the producer's
    // spelling, checked against a live payload.
    y_pct: x.map((_, index) => ((index + 1) / REQUESTS) * 100),
  };
}

/** As served by `runs/{id}/subjects/slo-general/payload`, CDFs included. */
export const RUN_LATENCY = {
  schema_version: 1,
  meta: { log_dir: 'logs/run/rate1', max_cdf_points: 1000 },
  definitions: { ttft: 'first_token_time - arrival' },
  series: [
    cdf('e2e', 'E2E', 'ms', 40000, 43000),
    cdf('ttft', 'TTFT', 'ms', 23, 27.9),
    // Per generated token, which is the unit the analysis publishes it in — not
    // milliseconds, and a chart that labelled it so would be off by the output
    // length.
    cdf('tpot', 'TPOT', 'ms/token', 3.8, 4.4),
  ],
};

/**
 * As served by `runs/{id}/subjects/topology/payload`.
 *
 * Two pools of two single-GPU workers, which is where `GPUS` comes from.
 * Everything interesting about the map — a worker id that means different
 * things in different pools, a pool staying lit while one of its workers is
 * open — needs more than one of each.
 */
export const RUN_TOPOLOGY = {
  schema_version: 1,
  params: {
    deployment: 'pd',
    pools: {
      prefill: {
        placement: 'least-queued',
        groups: [
          {
            gpu: 'NVIDIA H200',
            replicas: 2,
            // Spelled as the simulator's `Llama3DenseTp` selector spells it:
            // the flattened `ModelSpec` fields beside the sharding parameter.
            arch: {
              type: 'llama3_dense_tp',
              model_config: 'model/config/llama3_8b.json',
              tp_size: 1,
              fp8: false,
            },
            worker: { type: 'barebone' },
          },
        ],
      },
      decode: {
        placement: 'round-robin',
        groups: [
          {
            gpu: 'NVIDIA H200',
            replicas: 2,
            arch: {
              type: 'llama3_dense_tp',
              model_config: 'model/config/llama3_8b.json',
              tp_size: 1,
              fp8: false,
            },
            worker: { type: 'chunked_prefill' },
          },
        ],
      },
    },
  },
  run_meta: {
    gpus: [0, 1, 2, 3].map((id) => ({
      id,
      name: 'NVIDIA H200',
      pool: id < 2 ? 0 : 1,
      pool_tag: id < 2 ? 'prefill' : 'decode',
    })),
    workers: [
      { worker_id: 0, pool_tag: 'prefill', gpu_ids: [0] },
      { worker_id: 1, pool_tag: 'prefill', gpu_ids: [1] },
      { worker_id: 0, pool_tag: 'decode', gpu_ids: [2] },
      { worker_id: 1, pool_tag: 'decode', gpu_ids: [3] },
    ],
  },
};

/** As served by `runs/{id}/subjects/model/payload`. */
export const RUN_MODEL = {
  schema_version: 2,
  source_path: 'model/config/llama3_8b.json',
  config: {
    num_hidden_layers: 32,
    torch_dtype: 'bfloat16',
    architectures: ['LlamaForCausalLM'],
  },
  parameter_counts: {
    active: 8030261248,
    active_definition: 'with_embed_head',
    active_layers: 6979588096,
    total: 8030261248,
  },
};

/** As served by `runs/{id}/subjects/workload/payload`. */
export const RUN_WORKLOAD = {
  schema_version: 1,
  scope: 'configured_trace',
  source_paths: ['trace/sharegpt.csv'],
  request_count: REQUESTS,
  average_input_tokens: 1024,
  average_output_tokens: 256,
  arrival_basis: 'effective_open_loop',
  request_rate: perSecond(REQUESTS),
  token_lengths: [16, 64, 256, 1024, 4096],
  input_density: [0.05, 0.2, 0.55, 1, 0.25],
  output_density: [0.2, 0.65, 1, 0.4, 0.05],
  arrival_seconds: [0, 128, 256, 384, 512],
  arrivals: [120, 135, 126, 131, 0],
  arrival_trend: [120, 124, 128, 131, 0],
  peak_to_mean: 1.08,
};

/** Descriptor and unavailable optimality response for focused run-panel specs.
 * These tests exercise other subjects, but the reproduced run layout mounts
 * the legacy Optimality section as well. Serving an explicit unavailable
 * capability keeps the fixture honest and avoids turning an expected absence
 * into browser-level 404 noise. */
export const RUN_DESCRIPTOR = {
  protocol_version: 1,
  workspace_id: 'w_main',
  run_id: '20260907_0_llama3_h200_throughput',
  kind: 'simulation',
  display_name: '20260907_0_llama3_h200_throughput',
  deployment: 'pd',
  lifecycle: { simulation: 'complete', analysis: 'complete' },
  summary: { views: ['report'] },
  subjects: {
    optimality: {
      status: 'unavailable',
      reason: 'not generated in focused run-panel fixture',
    },
  },
  details: {},
  traces: {},
  analysis: {
    revision: 'analysis-v2',
    generated_at: '2026-09-10T00:00:00Z',
    generator_version: 'test',
  },
};

export const RUN_OPTIMALITY_UNAVAILABLE = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    available: false,
    reason: 'not generated in focused run-panel fixture',
  },
  levels: [],
  kernels: [],
  worker_kernel_ladders: [],
  aggregate_kernel_ladders: [],
};

/**
 * The four workers of `RUN_TOPOLOGY`, and what each spent its kernel time on.
 *
 * The numbers are chosen to satisfy the schema's cross-checks rather than to
 * look plausible: pools sum to `overall`, the worker index sums to its pool,
 * and every share follows from its own time. A fixture that failed one of them
 * would be refused by the reader and the spec using it would fail somewhere far
 * from the cause.
 */
const POSITIONS = [
  { name: 'attn.decode', kind: 'flashinfer_attn_decode', share: 0.6 },
  { name: 'ffn.gemm', kind: 'single_gemm', share: 0.4 },
];

/** The same mixture at every scope, scaled to that scope's kernel time. */
function mixture(kernelTimeMs: number) {
  return POSITIONS.map((position) => ({
    position: position.name,
    kind: position.kind,
    kernel_time_ms: kernelTimeMs * position.share,
    share_pct: position.share * 100,
  }));
}

/**
 * How busy each worker was, and therefore how much kernel time it ran.
 *
 * One list, because these are one measurement. Both producers sum the same
 * `cost_log.total_time_ms`: a worker's utilization *is* its kernel time over the
 * run's span, and a live run confirms it to the last decimal. Stated as the
 * fraction with the milliseconds derived, so the two can only agree — written
 * the other way round they drifted four orders of magnitude apart, with each
 * document still passing its own reconciliation.
 *
 * The fractions are the ones the utilization panel's story needs: `decode`
 * averages 60% over a worker at 90% and a worker at 30%, while `prefill` sits at
 * 50% on both, so the run's two pools look ten points apart and the worst worker
 * in the run is inside the busier of them.
 */
const BUSY = [
  { pool_tag: 'prefill', pool: 0, worker_id: 0, avg_util: 0.5, raw_rows: 400_000 },
  { pool_tag: 'prefill', pool: 0, worker_id: 1, avg_util: 0.5, raw_rows: 200_000 },
  { pool_tag: 'decode', pool: 1, worker_id: 0, avg_util: 0.9, raw_rows: 300_000 },
  { pool_tag: 'decode', pool: 1, worker_id: 1, avg_util: 0.3, raw_rows: 100_000 },
];

/**
 * The replay budget the kernel-time producer works to, split across the roster.
 *
 * `kernel_time_share.rs` gives every worker `MAX_REPLAY_ROWS / n_workers` rows
 * and then picks the smallest stride that fits — so the stride is not a setting
 * the report carries but a number implied by the row counts and the roster size.
 * Stated as a stride, the fixture claimed a sampling this deployment could not
 * have produced: four workers of a few hundred rows each are replayed whole, and
 * the report would have said `exact`.
 */
const MAX_REPLAY_ROWS = 250_000;
const REPLAY_BUDGET_PER_WORKER = Math.max(Math.floor(MAX_REPLAY_ROWS / BUSY.length), 1);

function sampling(rawRows: number) {
  const stride = Math.max(Math.ceil(rawRows / REPLAY_BUDGET_PER_WORKER), 1);
  return {
    raw_rows: rawRows,
    // Every `stride`-th iteration, so the rows that survive are the count
    // divided by the stride and rounded up — the first one always survives.
    sampled_rows: Math.ceil(rawRows / stride),
    sample_stride: stride,
  };
}

const WORKER_TIMES = BUSY.map((worker) => ({
  pool_tag: worker.pool_tag,
  worker_id: worker.worker_id,
  kernel_time_ms: worker.avg_util * SIM_MS,
  ...sampling(worker.raw_rows),
}));

/** Whether every worker was replayed whole, which is what the producer calls exact. */
const REPLAY_EXACT = WORKER_TIMES.every((worker) => worker.sample_stride === 1);

function poolTime(tag: string): number {
  return WORKER_TIMES.filter((worker) => worker.pool_tag === tag).reduce(
    (sum, worker) => sum + worker.kernel_time_ms,
    0,
  );
}

const RUN_KERNEL_TIME_MS = WORKER_TIMES.reduce((sum, worker) => sum + worker.kernel_time_ms, 0);

/**
 * A cluster kernel-time read, reduced to what this build decodes.
 *
 * Not the whole envelope the service sends — it carries replay and cache
 * metadata this build has no reader for — but every field below is spelled and
 * shaped as the service spells it.
 */
export const RUN_KERNEL_TIME = {
  schema_version: 2,
  available: true,
  meta: {
    exact: REPLAY_EXACT,
    sampling_method: REPLAY_EXACT ? 'all rows' : 'worker-local regular iter_id stride',
    max_replay_rows_target: MAX_REPLAY_ROWS,
    raw_rows: WORKER_TIMES.reduce((sum, worker) => sum + worker.raw_rows, 0),
    sampled_rows: WORKER_TIMES.reduce((sum, worker) => sum + worker.sampled_rows, 0),
    num_positions: POSITIONS.length,
    num_pools: 2,
    num_workers: WORKER_TIMES.length,
  },
  overall: { kernel_time_ms: RUN_KERNEL_TIME_MS, segments: mixture(RUN_KERNEL_TIME_MS) },
  pools: ['prefill', 'decode'].map((tag) => ({
    pool_tag: tag,
    num_workers: WORKER_TIMES.filter((worker) => worker.pool_tag === tag).length,
    kernel_time_ms: poolTime(tag),
    segments: mixture(poolTime(tag)),
  })),
  workers: WORKER_TIMES.map((worker) => ({
    pool_tag: worker.pool_tag,
    worker_id: worker.worker_id,
    kernel_time_ms: worker.kernel_time_ms,
    ...sampling(worker.raw_rows),
  })),
  positions: POSITIONS.map((position) => ({
    name: position.name,
    kind: position.kind,
    overall_share_pct: position.share * 100,
  })),
  definitions: { tree_attribution: 'critical path with Sum/Scale/Max/overlap' },
};

/**
 * One worker's composition, as served at that worker's own address.
 *
 * `null` for a worker this run does not have, so a stub can answer the way the
 * service does — 404 — instead of inventing a worker the topology denies.
 */
function runWorkerKernelTime(poolTag: string, workerId: string) {
  const worker = WORKER_TIMES.find(
    (candidate) => candidate.pool_tag === poolTag && String(candidate.worker_id) === workerId,
  );
  if (worker === undefined) return null;
  return {
    schema_version: 2,
    scope: { kind: 'worker', pool_tag: worker.pool_tag, worker_id: worker.worker_id },
    kernel_time_ms: worker.kernel_time_ms,
    segments: mixture(worker.kernel_time_ms),
    ...sampling(worker.raw_rows),
  };
}

/**
 * As reported by `runs/{id}/subjects/request-state/report`.
 *
 * The same cluster as `RUN_TOPOLOGY` — two pools of two workers — with the
 * numbers chosen so the two statistics **put a different row first**. By the
 * average, decode is five times prefill; by the worst moment prefill is the
 * worse of the two, and inside decode the same reversal holds between its two
 * workers. A fixture where the mean and the peak ranked the same way would pass
 * every assertion in the queue spec with the control ignored entirely.
 *
 * Every identity the schema checks holds here: worker queues sum to their pool,
 * a pool's per-worker average is its total over the roster, each pool's peak
 * sits between its busiest worker and its workers' sum, and the cluster's
 * populations add up over the workers.
 */
const REQUEST_STATE_WORKERS = [
  { pool_tag: 'prefill', worker_id: 0, mean: 1, peak: 50 },
  { pool_tag: 'prefill', worker_id: 1, mean: 3, peak: 45 },
  // Five on average and the worst single moment in its pool; worker 1 is the
  // other way round, so a pool view reverses when the statistic changes.
  { pool_tag: 'decode', worker_id: 0, mean: 5, peak: 60 },
  { pool_tag: 'decode', worker_id: 1, mean: 15, peak: 40 },
];

/**
 * Every worker was working on the same number of requests at once — and, in this
 * fixture, at the *same* moments.
 *
 * That second part is what lets the cluster peak be four times the worker peak
 * rather than something between 5 and 20. Simultaneous peaks are a coincidence a
 * real run need not supply, so it is stated here rather than left to be inferred
 * from the multiplication below.
 */
const ACTIVE_PER_WORKER = { mean: 3, peak: 5 };

/**
 * Where the run's finished requests are.
 *
 * `request_state.rs` leaves every tracked request resident in the category it
 * last entered, so a run that drained to completion holds all 512 of them in
 * `done` at the end — which is also when every worker's count peaks, so these
 * add rather than bracket. Without this population the report would be a
 * conservation failure: 512 requests tracked, and at most 120 of them anywhere
 * in the categories the run publishes.
 *
 * The peak follows from that: four workers each ending with a quarter of the
 * requests. The *mean* does not follow from anything — it is a time-weighted
 * average over the run, so it depends on when requests finished, which no other
 * number here records. Half the peak is the assumption being made: completions
 * spread evenly enough that a worker's `done` count was on average half what it
 * ended at. Written as `REQUESTS / 8` it looks derived; it is the assumption
 * arithmetic, and it is stated here so that changing `REQUESTS` moves it and
 * changing the completion story is known to require rewriting it.
 */
const DONE_PER_WORKER = { mean: REQUESTS / 8, peak: REQUESTS / 4 };

/**
 * A pool's pending queue, and the cluster's.
 *
 * The mean is the sum of its workers' means, because a mean over a time-weighted
 * bin series is linear and the pool's queue *is* its workers' queues. The peak
 * is not: two workers need not peak in the same bin, so the pool's worst moment
 * is somewhere between its worst worker and its workers' sum. That one is stated
 * — it is a fact about when things happened, not arithmetic — and the schema
 * checks it against the bracket.
 */
function pendingMean(pools: readonly string[]): number {
  return REQUEST_STATE_WORKERS.filter((worker) => pools.includes(worker.pool_tag)).reduce(
    (total, worker) => total + worker.mean,
    0,
  );
}

const REQUEST_STATE_POOLS = [
  { pool_tag: 'prefill', pool: 0, mean: pendingMean(['prefill']), peak: 90 },
  { pool_tag: 'decode', pool: 1, mean: pendingMean(['decode']), peak: 80 },
];

export const RUN_REQUEST_STATE = {
  schema_version: 1,
  available: true,
  meta: {
    deployment: 'disaggregated',
    requests_with_stage_history: REQUESTS,
    transitions: 2048,
    span_ms: SIM_MS,
    num_bins: BINS,
    bin_width_ms: SIM_MS / BINS,
    aggregation: 'equal-width time-weighted mean',
  },
  totals: {
    cluster_categories: [
      { category: 'pending', mean: pendingMean(['prefill', 'decode']), peak: 100 },
      {
        category: 'active',
        mean: ACTIVE_PER_WORKER.mean * REQUEST_STATE_WORKERS.length,
        peak: ACTIVE_PER_WORKER.peak * REQUEST_STATE_WORKERS.length,
      },
      {
        category: 'done',
        mean: DONE_PER_WORKER.mean * REQUEST_STATE_WORKERS.length,
        peak: DONE_PER_WORKER.peak * REQUEST_STATE_WORKERS.length,
      },
    ],
    pools: REQUEST_STATE_POOLS.map((pool) => {
      const roster = REQUEST_STATE_WORKERS.filter(
        (worker) => worker.pool_tag === pool.pool_tag,
      ).length;
      return {
        pool: pool.pool,
        pool_tag: pool.pool_tag,
        n_workers: roster,
        mean_total_pending: pool.mean,
        peak_total_pending: pool.peak,
        mean_pending_per_worker: pool.mean / roster,
      };
    }),
    workers: REQUEST_STATE_WORKERS.map((worker) => ({
      pool: worker.pool_tag === 'prefill' ? 0 : 1,
      pool_tag: worker.pool_tag,
      worker_id: worker.worker_id,
      mean_pending: worker.mean,
      peak_pending: worker.peak,
      categories: [
        { category: 'pending', mean: worker.mean, peak: worker.peak },
        { category: 'active', mean: ACTIVE_PER_WORKER.mean, peak: ACTIVE_PER_WORKER.peak },
        { category: 'done', mean: DONE_PER_WORKER.mean, peak: DONE_PER_WORKER.peak },
      ],
    })),
  },
  definitions: { pending: 'all pending:* stages, grouped by the request-owner location' },
};

function requestStateWorker(
  workerId: number,
  pending: readonly [number, number],
  active: readonly [number, number],
  done: readonly [number, number],
) {
  return {
    worker_id: workerId,
    pending,
    series: [
      { category: 'pending', values: pending },
      { category: 'active', values: active },
      { category: 'done', values: done },
    ],
  };
}

const PREFILL_REQUEST_WORKERS = [
  requestStateWorker(0, [20, 10], [2, 3], [0, 10]),
  requestStateWorker(1, [30, 20], [2, 3], [0, 10]),
];
const DECODE_REQUEST_WORKERS = [
  requestStateWorker(0, [5, 10], [1, 2], [0, 20]),
  requestStateWorker(1, [15, 20], [1, 2], [0, 20]),
];

/** Full category timelines used by the pre-refactor cluster, pool, and worker charts. */
export const RUN_REQUEST_STATE_SERIES = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    deployment: 'disaggregated',
    requests_with_stage_history: REQUESTS,
    transitions: 2048,
    span_ms: SIM_MS,
    num_bins: 2,
    bin_width_ms: SIM_MS / 2,
    aggregation: 'equal-width time-weighted mean',
  },
  t_start_ms: [0, SIM_MS / 2],
  t_end_ms: [SIM_MS / 2, SIM_MS],
  cluster_series: [
    { category: 'pending', values: [70, 60] },
    { category: 'active', values: [6, 10] },
    { category: 'done', values: [0, 60] },
  ],
  pools: [
    {
      pool: 0,
      pool_tag: 'prefill',
      n_workers: 2,
      total_pending: [50, 30],
      average_pending: [25, 15],
      workers: PREFILL_REQUEST_WORKERS,
    },
    {
      pool: 1,
      pool_tag: 'decode',
      n_workers: 2,
      total_pending: [20, 30],
      average_pending: [10, 15],
      workers: DECODE_REQUEST_WORKERS,
    },
  ],
  definitions: { pending: 'all pending:* stages, grouped by request owner' },
};

/**
 * A pool's fraction, and the run's, for `runs/{id}/subjects/utilization/report`.
 *
 * Computed rather than written down, and the arithmetic is the producer's own:
 * a scope's utilization is its busy time over `span × workers`, which for
 * workers that all ran the same span is the plain mean of their fractions. That
 * capacity weighting is why the run comes out at 0.55 and not at the mean of
 * 0.5 and 0.6 — which here happen to be the same number, because both pools
 * have the same roster. The schema's unit tests use pools of different sizes,
 * where the two answers differ and only one of them is right.
 */
function poolBusy(tag: string): number {
  const own = BUSY.filter((worker) => worker.pool_tag === tag);
  return own.reduce((total, worker) => total + worker.avg_util, 0) / own.length;
}

const OVERALL_BUSY = BUSY.reduce((total, worker) => total + worker.avg_util, 0) / BUSY.length;

export const RUN_UTILIZATION = {
  schema_version: 1,
  available: true,
  meta: {
    gpu_name: 'NVIDIA H200',
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    num_pools: 2,
    num_workers: BUSY.length,
    span_ms: SIM_MS,
    num_bins: BINS,
    bin_width_ms: SIM_MS / BINS,
  },
  totals: {
    overall_avg: OVERALL_BUSY,
    // Busiest first, which is the *opposite* of the order this panel draws them
    // in. Deliberate: listed the other way round, a build that forgot to sort at
    // all would render the expected order anyway, and the test asserting it
    // would be asserting the Analyzer's iteration.
    per_pool: [
      { pool: 1, pool_tag: 'decode', n_workers: 2, avg_util: poolBusy('decode') },
      { pool: 0, pool_tag: 'prefill', n_workers: 2, avg_util: poolBusy('prefill') },
    ],
    per_worker: BUSY.map(({ pool_tag, pool, worker_id, avg_util }) => ({
      pool_tag,
      pool,
      worker_id,
      avg_util,
    })),
  },
  definitions: {
    avg_util: 'worker busy time / span, or pool busy time / (span × workers_in_pool)',
  },
};

/** Full pool and worker timelines used by the pre-refactor utilization charts. */
export const RUN_UTILIZATION_SERIES = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    gpu_name: 'NVIDIA H200',
    unit: 'fraction of pool workers busy (0-1)',
    worker_unit: 'fraction of worker/GPU busy time (0-1)',
    avg: {},
  },
  t_start_ms: [0, SIM_MS / 2],
  t_end_ms: [SIM_MS / 2, SIM_MS],
  series: ['prefill', 'decode'].map((poolTag, pool) => ({
    key: `pool_${pool}`,
    label: poolTag,
    pool_tag: poolTag,
    util: [poolBusy(poolTag) - 0.05, poolBusy(poolTag) + 0.05],
  })),
  worker_series: BUSY.map((worker) => ({
    key: `${worker.pool_tag}_${worker.worker_id}`,
    label: `${worker.pool_tag}/${worker.worker_id}`,
    pool_tag: worker.pool_tag,
    worker_id: worker.worker_id,
    util: [worker.avg_util - 0.05, worker.avg_util + 0.05],
  })),
  definitions: {
    util: 'fraction of the interval spent computing',
  },
};

/**
 * As reported by `runs/{id}/subjects/kv-occupancy/report`.
 *
 * The same two pools, arranged so that **the fullest pool is not the pool in
 * trouble**. `decode` peaked at 92% resident and its admission gate expects 95%
 * — a cache that is genuinely full and coping. `prefill` peaked at 30% and its
 * gate has already promised 120% — a third full, with requests being held out
 * against memory that is free right now.
 *
 * A fixture where the two ranked together would let the panel show only
 * occupancy and still pass, which is the exact confusion the panel exists to
 * prevent.
 */
const KV_CAPACITY = 262144;

/** A level as the report publishes it: tokens and the same figure over capacity. */
function level(name: string, meanPct: number, maxPct: number) {
  return {
    [`peak_${name}_mean_tokens`]: KV_CAPACITY * meanPct,
    [`peak_${name}_mean_pct`]: meanPct,
    [`peak_${name}_max_tokens`]: KV_CAPACITY * maxPct,
    [`peak_${name}_max_pct`]: maxPct,
  };
}

const KV_SERIES = [
  // Fullest, and fine: the gate's horizon is barely above what is resident.
  {
    pool_tag: 'decode',
    resident: [0.75, 0.92],
    prefix: [0.1, 0.15],
    projected: [0.8, 0.95],
    promised: 0.02,
    mean: 0.6,
  },
  // Emptier, and stalling: the gate has promised a fifth more than the pool has.
  {
    pool_tag: 'prefill',
    resident: [0.2, 0.3],
    prefix: [0.05, 0.08],
    projected: [0.9, 1.2],
    promised: 0.35,
    mean: 0.12,
  },
];

export const RUN_KV_OCCUPANCY = {
  schema_version: 1,
  available: true,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    num_series: KV_SERIES.length,
    num_bins: BINS,
    bin_width_ms: SIM_MS / BINS,
    span_ms: SIM_MS,
    has_capacity: true,
    has_retained_prefix_breakdown: true,
  },
  totals: {
    per_series: KV_SERIES.map((series) => ({
      pool_tag: series.pool_tag,
      group_id: 0,
      capacity_tokens: KV_CAPACITY,
      n_workers: 2,
      ...level('active', series.resident[0], series.resident[1]),
      mean_active_pct: series.mean,
      ...level('retained_prefix', series.prefix[0], series.prefix[1]),
      peak_projected_mean_tokens: KV_CAPACITY * series.projected[0],
      peak_projected_mean_pct: series.projected[0],
      // No worst-shard token count beside it: the analysis publishes only the
      // fraction, and this fixture does not invent the number it omits.
      peak_projected_max_pct: series.projected[1],
      peak_promised_max_tokens: KV_CAPACITY * series.promised,
      peak_promised_max_pct: series.promised,
    })),
  },
  definitions: { active_tokens: 'resident/committed KV blocks, in tokens' },
};

function kvBand(fractions: readonly number[], delta: number) {
  return {
    mean: fractions.map((value) => KV_CAPACITY * value),
    min: fractions.map((value) => KV_CAPACITY * (value - delta)),
    max: fractions.map((value) => KV_CAPACITY * (value + delta)),
  };
}

/** Full per-worker timelines used by the pre-refactor pool and worker charts. */
export const RUN_KV_OCCUPANCY_SERIES = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    unit: 'KV tokens (per shard); fraction = tokens / capacity_tokens',
    has_capacity: true,
    has_retained_prefix_breakdown: true,
  },
  t_start_ms: [0, SIM_MS / 2],
  t_end_ms: [SIM_MS / 2, SIM_MS],
  series: KV_SERIES.map((series, groupId) => {
    const active = kvBand(series.resident, 0.05);
    const retained = kvBand(series.prefix, 0.01);
    const projected = kvBand(series.projected, 0.03);
    const promised = kvBand([series.promised, series.promised], 0.005);
    return {
      key: `${series.pool_tag}/g${groupId}`,
      label: series.pool_tag,
      pool_tag: series.pool_tag,
      group_id: groupId,
      capacity_tokens: KV_CAPACITY,
      n_workers: 2,
      workers: [0, 1].map((workerId) => ({
        worker_id: workerId,
        active_tokens: workerId === 0 ? active.min : active.max,
        retained_prefix_tokens: workerId === 0 ? retained.min : retained.max,
        projected_tokens: workerId === 0 ? projected.min : projected.max,
        promised_tokens: workerId === 0 ? promised.min : promised.max,
      })),
      active,
      retained_prefix: retained,
      projected,
      promised,
    };
  }),
  definitions: { active_tokens: 'resident/committed KV blocks, in tokens' },
};

/**
 * As reported by `runs/{id}/subjects/batch/report`.
 *
 * The same four workers, arranged so that **the busier pool is the one running
 * nothing per invocation**. `decode` is at 60% utilization on a median batch of
 * 2 tokens; `prefill` is at 50% on a median of 580. Read beside the utilization
 * panel, that is the whole subject: two pools ten points apart in how busy they
 * were, and two orders of magnitude apart in what they were busy with.
 *
 * Inside `decode` the same reversal holds — worker 0 runs a median of 4 and
 * worker 1 a median of 1 — so a pool's average hides the worker being under-fed,
 * exactly as it does for utilization.
 *
 * Every invocation count is the worker's cost-log row count from `BUSY`: batch
 * composition and kernel time bucket the same rows, so a reader carrying a
 * number between the two panels must find the same one.
 */
const BATCH_SAMPLED_PER_WORKER = 4000;

/** One metric's five figures, as `stats()` publishes them. */
function stat(n: number, mean: number, p50: number, p90: number, p99: number, max: number) {
  return { n, mean, p50, p90, p99, max };
}

const BATCH_WORKERS = [
  {
    pool_tag: 'prefill',
    worker_id: 0,
    batch: [800, 780, 1000, 1020, 1024],
    prefill: [798, 778, 998, 1018, 1024],
    decode: [2, 2, 3, 4, 6],
  },
  {
    pool_tag: 'prefill',
    worker_id: 1,
    batch: [400, 380, 600, 900, 1024],
    prefill: [398, 378, 598, 898, 1024],
    decode: [2, 2, 3, 4, 6],
  },
  // Listed largest-median first, which is the opposite of the order the pool
  // panel draws them in: a build that forgot to rank would render the expected
  // order anyway and the test would be asserting the Analyzer's iteration.
  {
    pool_tag: 'decode',
    worker_id: 0,
    batch: [7, 4, 16, 40, 1025],
    prefill: [6, 0, 8, 32, 1024],
    decode: [1, 1, 8, 8, 8],
  },
  {
    pool_tag: 'decode',
    worker_id: 1,
    batch: [3, 1, 6, 12, 512],
    prefill: [2, 0, 4, 10, 512],
    decode: [1, 1, 2, 2, 4],
  },
];

/**
 * A pool's own distribution.
 *
 * The mean is the sample-weighted mean of its workers', because a mean is linear
 * over the union of two samples. The percentiles are not — they are stated,
 * because a percentile of a union is not a function of the two percentiles — and
 * the maximum is, because it is.
 */
function batchPool(tag: string, p50: number, p90: number, p99: number) {
  const own = BATCH_WORKERS.filter((worker) => worker.pool_tag === tag);
  const across = (pick: (worker: (typeof own)[number]) => readonly number[]) => ({
    mean: own.reduce((total, worker) => total + pick(worker)[0], 0) / own.length,
    max: Math.max(...own.map((worker) => pick(worker)[4])),
  });
  const batch = across((worker) => worker.batch);
  const prefill = across((worker) => worker.prefill);
  const decode = across((worker) => worker.decode);
  const rows = own.reduce(
    (total, worker) =>
      total +
      (BUSY.find((busy) => busy.pool_tag === tag && busy.worker_id === worker.worker_id)
        ?.raw_rows ?? 0),
    0,
  );
  const n = BATCH_SAMPLED_PER_WORKER * own.length;
  return {
    pool: tag,
    num_calls: rows,
    metrics: {
      batch_tokens: stat(n, batch.mean, p50, p90, p99, batch.max),
      // The components' percentiles are shifted down with the batch's, so the
      // pool's shape is the same shape its workers had.
      prefill_tokens: stat(n, prefill.mean, p50 - 2, p90 - 2, p99 - 2, prefill.max),
      decode_request_count: stat(n, decode.mean, 1, 3, 4, decode.max),
    },
  };
}

export const RUN_BATCH = {
  schema_version: 1,
  available: true,
  meta: {
    log_dir: 'logs/20260907_0_llama3_h200_throughput',
    num_calls: BUSY.reduce((total, worker) => total + worker.raw_rows, 0),
    num_pools: 2,
    num_workers: BATCH_WORKERS.length,
    target_sampled_iters: 4000,
  },
  // `prefill` first, which is the reverse of the name order the run panel draws.
  pools: [batchPool('prefill', 580, 800, 960), batchPool('decode', 2, 12, 36)],
  workers: BATCH_WORKERS.map((worker) => ({
    pool_tag: worker.pool_tag,
    worker_id: worker.worker_id,
    num_calls:
      BUSY.find((busy) => busy.pool_tag === worker.pool_tag && busy.worker_id === worker.worker_id)
        ?.raw_rows ?? 0,
    metrics: {
      batch_tokens: stat(
        BATCH_SAMPLED_PER_WORKER,
        ...(worker.batch as [number, number, number, number, number]),
      ),
      prefill_tokens: stat(
        BATCH_SAMPLED_PER_WORKER,
        ...(worker.prefill as [number, number, number, number, number]),
      ),
      decode_request_count: stat(
        BATCH_SAMPLED_PER_WORKER,
        ...(worker.decode as [number, number, number, number, number]),
      ),
    },
  })),
  definitions: {
    batch_tokens: 'tokens in the batch this kernel invocation ran',
    decode_request_count: 'decode requests in the batch; speculative verify rows are not counted',
  },
};

function batchTimelineScope(
  pool: string,
  workerId: number | null,
  batch: readonly number[],
  prefill: readonly number[],
  decode: readonly number[],
) {
  const numCalls = workerId === null ? 200_000 : 100_000;
  return {
    ...(workerId === null ? { pool } : { pool_tag: pool, worker_id: workerId }),
    num_calls: numCalls,
    plotted_points: 2,
    avg: {
      batch_tokens: (batch[0] + batch[1]) / 2,
      prefill_tokens: (prefill[0] + prefill[1]) / 2,
      decode_request_count: (decode[0] + decode[1]) / 2,
    },
    time_ms: [0, 1_000],
    series: [
      { key: 'batch_tokens', label: 'Batch tokens', values: batch },
      { key: 'prefill_tokens', label: 'Prefill tokens', values: prefill },
      { key: 'decode_request_count', label: 'Decode requests', values: decode },
    ],
  };
}

/** Full invocation timelines used by the pre-refactor pool and worker charts. */
export const RUN_BATCH_SERIES = {
  schema_version: 1,
  available: true,
  meta: { log_dir: 'logs/20260907_0_llama3_h200_throughput', num_calls: 1_000_000 },
  pools: [
    batchTimelineScope('prefill', null, [1_200, 1_000], [1_196, 996], [4, 4]),
    batchTimelineScope('decode', null, [10, 8], [6, 4], [4, 4]),
  ],
  workers: [
    batchTimelineScope('prefill', 0, [800, 780], [798, 778], [2, 2]),
    batchTimelineScope('prefill', 1, [400, 380], [398, 378], [2, 2]),
    batchTimelineScope('decode', 0, [7, 4], [6, 0], [1, 1]),
    batchTimelineScope('decode', 1, [3, 1], [2, 0], [1, 1]),
  ],
  definitions: {
    batch_tokens: 'tokens in the batch this kernel invocation ran',
    decode_request_count: 'decode requests in the batch',
  },
};

/**
 * Answer a run page's reads so it renders without complaining.
 *
 * For specs whose subject is something else on the page — the docked chat, the
 * address bar — where an unanswered read would fail the console-error guard for
 * a reason that has nothing to do with what is being tested.
 */
export async function serveRunPage(page: Page): Promise<void> {
  await serveRunOverviewResources(page);
  await page.route('**/api/analyzer/v1/runs/*/subjects/summary/report*', (route) =>
    route.fulfill({ json: RUN_SUMMARY }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/slo-general/payload*', (route) =>
    route.fulfill({ json: RUN_LATENCY }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/concurrency/payload*', (route) =>
    route.fulfill({ json: RUN_CONCURRENCY }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/topology/payload*', (route) =>
    route.fulfill({ json: RUN_TOPOLOGY }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/model/payload*', (route) =>
    route.fulfill({ json: RUN_MODEL }),
  );
  await serveRunKernelTime(page);
  await serveRunRequestState(page);
  await serveRunUtilization(page);
  await serveRunKvOccupancy(page);
  await serveRunBatch(page);
  await serveRunThroughput(page);
  await serveRunConservation(page);
  await page.route(
    '**/api/analyzer/v1/runs/*/workers/ffn/2/iterations/17/subjects/optimality-kernel-ladder/payload*',
    (route) =>
      route.fulfill({
        json: {
          schema_version: 1,
          unit: 'gpu_seconds',
          worker: { pool_tag: 'ffn', worker_id: 2 },
          iter_id: 17,
          rungs: {
            real: 0,
            busy: 0,
            balanced: 0,
            per_config_best: 0,
            ignore_network: 0,
            hardware_limit: 0,
          },
          special_chunks: { idle: 0, imbalance: 0 },
          kernels: [],
          meta: {
            gpu_name: 'NVIDIA H200',
            gpu_spec_matched: null,
            peaks_source: 'fixture',
            gpu_count: 1,
            folded_rows: 1,
          },
        },
      }),
  );
  await page.route(
    '**/api/analyzer/v1/runs/*/workers/ffn/2/iterations/17/subjects/optimality-waterfall/payload*',
    (route) =>
      route.fulfill({
        json: {
          schema_version: 1,
          unit: 'gpu_seconds',
          worker: { pool_tag: 'ffn', worker_id: 2 },
          iter_id: 17,
          level: {
            level: 'iteration',
            key: 'ffn/2/17',
            label: 'ffn/2 / iter 17',
            total: 0,
            buckets: {
              idle: 0,
              imbalance: 0,
              batching: 0,
              communication: 0,
              hardware_gap: 0,
              hardware_optimal: 0,
            },
            optimality_ratio: 0,
          },
          meta: {
            gpu_name: 'NVIDIA H200',
            gpu_spec_matched: null,
            peaks_source: 'fixture',
          },
        },
      }),
  );
}

/** Overview resources shared by focused specs that assemble the run page themselves. */
export async function serveRunOverviewResources(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/descriptor*', (route) =>
    route.fulfill({ json: RUN_DESCRIPTOR }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/optimality/payload*', (route) =>
    route.fulfill({ json: RUN_OPTIMALITY_UNAVAILABLE }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/workload/payload*', (route) =>
    route.fulfill({ json: RUN_WORKLOAD }),
  );
  await page.route('**/api/analyzer/v1/runs', (route) =>
    route.fulfill({
      json: {
        protocol_version: 1,
        generated_at: '2026-09-10T00:00:00Z',
        runs: [],
      },
    }),
  );
}

/**
 * As served by `runs/{id}/subjects/throughput/report`.
 *
 * A run that ramps: the first tenth of the window carries a fiftieth of the
 * tokens, and the rest of it makes up the difference. That shape is the point —
 * a flat fixture would let a panel that printed the run average four times over
 * pass every assertion, and the whole subject exists to say that the average is
 * not a rate the run sustained.
 *
 * Built from the same token totals and span as `RUN_SUMMARY`, because they are
 * the same run: the overview leads with `total_tok_s` and this panel takes that
 * number apart, so a fixture where they disagree is one where the panel appears
 * to contradict the panel above it.
 */
/**
 * The slow opening is two adjacent intervals, not one.
 *
 * A single slow interval cannot tell the two readings of "the longest slow
 * stretch" apart: taking the widest slow interval and merging the adjacent ones
 * both answer with the same window, so an assertion over this fixture would
 * agree with an implementation that measured the logging cadence instead of the
 * run. Split, the two readings diverge — merged gives 0 s → 51.2 s and widest
 * single gives 0 s → 25.6 s — and the assertion becomes worth making.
 */
const THROUGHPUT_BOUNDS_MS = [0, SIM_MS * 0.05, SIM_MS * 0.1, SIM_MS * 0.4, SIM_MS * 0.7, SIM_MS];
/** Prefill tokens per segment; the last is the remainder, so the sum is exact. */
const THROUGHPUT_PREFILL = [5243, 5243, 157286, 157286, PREFILL_TOKENS - 10486 - 157286 - 157286];
const THROUGHPUT_DECODE = [1311, 1310, 39322, 39322, DECODE_TOKENS - 2621 - 39322 - 39322];

interface ThroughputSegmentWire {
  t_start_ms: number;
  t_end_ms: number;
  prefill_tps: number;
  decode_tps: number;
  total_tps: number;
  prefill_tps_per_gpu: number;
  decode_tps_per_gpu: number;
  total_tps_per_gpu: number;
}

/** One interval, with every rate the division the producer publishes. */
function throughputSegment(
  startMs: number,
  endMs: number,
  prefill: number,
  decode: number,
): ThroughputSegmentWire {
  const seconds = (endMs - startMs) / 1000;
  const prefillTps = prefill / seconds;
  const decodeTps = decode / seconds;
  const total = prefillTps + decodeTps;
  return {
    t_start_ms: startMs,
    t_end_ms: endMs,
    prefill_tps: prefillTps,
    decode_tps: decodeTps,
    total_tps: total,
    prefill_tps_per_gpu: prefillTps / GPUS,
    decode_tps_per_gpu: decodeTps / GPUS,
    total_tps_per_gpu: total / GPUS,
  };
}

const THROUGHPUT_SEGMENTS = THROUGHPUT_PREFILL.map((prefill, index) =>
  throughputSegment(
    THROUGHPUT_BOUNDS_MS[index],
    THROUGHPUT_BOUNDS_MS[index + 1],
    prefill,
    THROUGHPUT_DECODE[index],
  ),
);

/**
 * The cumulative token counts at a time inside the run, as `interp_cum` reads
 * them: linear between the boundaries the segments were built from.
 *
 * The coarse bins are a re-aggregation of the same tokens rather than a second
 * set of numbers, so they cannot describe a different run from the segments
 * above them.
 */
function throughputCumulative(atMs: number): { prefill: number; decode: number } {
  let prefill = 0;
  let decode = 0;
  for (const [index, segment] of THROUGHPUT_SEGMENTS.entries()) {
    if (atMs >= segment.t_end_ms) {
      prefill += THROUGHPUT_PREFILL[index];
      decode += THROUGHPUT_DECODE[index];
      continue;
    }
    if (atMs > segment.t_start_ms) {
      const through = (atMs - segment.t_start_ms) / (segment.t_end_ms - segment.t_start_ms);
      prefill += THROUGHPUT_PREFILL[index] * through;
      decode += THROUGHPUT_DECODE[index] * through;
    }
    break;
  }
  return { prefill, decode };
}

/** At most ten equal-width bins, edge to edge across the whole window. */
const THROUGHPUT_BINS = 10;
const RUN_THROUGHPUT_SEGMENTS_BINNED = Array.from({ length: THROUGHPUT_BINS }, (_, index) => {
  const startMs = (SIM_MS * index) / THROUGHPUT_BINS;
  const endMs = (SIM_MS * (index + 1)) / THROUGHPUT_BINS;
  const from = throughputCumulative(startMs);
  const to = throughputCumulative(endMs);
  return throughputSegment(startMs, endMs, to.prefill - from.prefill, to.decode - from.decode);
});

export const RUN_THROUGHPUT = {
  schema_version: 1,
  available: true,
  meta: {
    num_gpus: GPUS,
    gpu_name: 'NVIDIA H200',
    num_segments: THROUGHPUT_SEGMENTS.length,
    num_bins: RUN_THROUGHPUT_SEGMENTS_BINNED.length,
    span_ms: SIM_MS,
    log_dir: 'logs/20260907_0_llama3_h200_throughput/rate1',
  },
  totals: {
    prefill_tokens: PREFILL_TOKENS,
    decode_tokens: DECODE_TOKENS,
    total_tokens: PREFILL_TOKENS + DECODE_TOKENS,
    prefill_tps: perSecond(PREFILL_TOKENS),
    decode_tps: perSecond(DECODE_TOKENS),
    total_tps: TOTAL_TOK_S,
    total_tps_per_gpu: TOTAL_TOK_S / GPUS,
  },
  segments: THROUGHPUT_SEGMENTS,
  binned_segments: RUN_THROUGHPUT_SEGMENTS_BINNED,
  definitions: {
    total_tps: 'prefill_tps + decode_tps',
    per_gpu: 'the corresponding rate divided by num_gpus (from run_meta.json)',
  },
};

function throughputTimelineView(segments: readonly ThroughputSegmentWire[]) {
  return {
    t_start_ms: segments.map((segment) => segment.t_start_ms),
    t_end_ms: segments.map((segment) => segment.t_end_ms),
    series: [
      {
        key: 'total',
        label: 'Total throughput',
        per_gpu: segments.map((segment) => segment.total_tps_per_gpu),
      },
      {
        key: 'prefill',
        label: 'Prefill throughput',
        per_gpu: segments.map((segment) => segment.prefill_tps_per_gpu),
      },
      {
        key: 'decode',
        label: 'Decode throughput',
        per_gpu: segments.map((segment) => segment.decode_tps_per_gpu),
      },
    ],
  };
}

const THROUGHPUT_FINE = throughputTimelineView(THROUGHPUT_SEGMENTS);

/** As served by `runs/{id}/subjects/throughput/payload`. */
export const RUN_THROUGHPUT_SERIES = {
  schema_version: 1,
  meta: {
    gpu_name: RUN_THROUGHPUT.meta.gpu_name,
    log_dir: RUN_THROUGHPUT.meta.log_dir,
    num_gpus: RUN_THROUGHPUT.meta.num_gpus,
    unit: 'tokens/s per GPU' as const,
    avg_per_gpu: {
      total: RUN_THROUGHPUT.totals.total_tps_per_gpu,
      prefill: RUN_THROUGHPUT.totals.prefill_tps / GPUS,
      decode: RUN_THROUGHPUT.totals.decode_tps / GPUS,
    },
  },
  ...THROUGHPUT_FINE,
  coarse: throughputTimelineView(RUN_THROUGHPUT_SEGMENTS_BINNED),
  definitions: RUN_THROUGHPUT.definitions,
};

/**
 * As served by `runs/{id}/subjects/workload-conservation/report`.
 *
 * The same run as everything else here, so the quantities are the ones the
 * other documents publish: the prefill total, one decode forward pass per
 * output token after the first, and the two of them through the FFN. A fixture
 * with invented totals would be a run whose conservation checks reconcile
 * against a workload no other panel describes.
 */
const DECODE_PASSES = DECODE_TOKENS - REQUESTS;

interface ConservationCheckWire {
  name: string;
  description: string;
  expected: number;
  actual: number;
  delta: number;
  delta_pct: number | null;
  status: 'OK' | 'WARN' | 'FAIL';
}

/** A check as the producer writes one: the gap and its share are derived. */
function conservationCheck(
  name: string,
  description: string,
  expected: number,
  actual: number,
): ConservationCheckWire {
  const delta = actual - expected;
  const percent = expected !== 0 ? (delta / expected) * 100 : delta === 0 ? 0 : null;
  const magnitude = percent === null ? Infinity : Math.abs(percent);
  return {
    name,
    description,
    expected,
    actual,
    delta,
    delta_pct: percent,
    // The producer's own thresholds, applied here rather than typed, so a
    // fixture cannot claim a verdict its numbers do not support.
    status: magnitude <= 0.01 ? 'OK' : magnitude <= 5 ? 'WARN' : 'FAIL',
  };
}

export const RUN_CONSERVATION = {
  schema_version: 1,
  available: true,
  meta: {
    deployment: 'unified',
    log_dir: 'logs/20260907_0_llama3_h200_throughput/rate1',
    mode: 'iterwise',
    num_requests: REQUESTS,
    num_iterations: 106435,
  },
  all_ok: true,
  tolerance_pct: 0.01,
  warn_pct: 5,
  checks: [
    conservationCheck(
      'prefill_tokens',
      'tokens prefilled: Σ cost_log prefill_tokens vs Σ request_slo prefill_processed',
      PREFILL_TOKENS,
      PREFILL_TOKENS,
    ),
    conservationCheck(
      'prefix_hit_bounds',
      'requests whose prefix_cache_hit_tokens exceeds declared_prefix_tokens vs 0',
      0,
      0,
    ),
    conservationCheck(
      'decode_passes',
      'decode forward passes: Σ cost_log decode_request_count vs Σ max(d-1-r,0)',
      DECODE_PASSES,
      DECODE_PASSES,
    ),
    conservationCheck(
      'ffn_token_pass',
      'tokens through FFN: Σ cost_log batch_tokens vs Σ [p + rp + max(d-1-r,0)]',
      PREFILL_TOKENS + DECODE_PASSES,
      PREFILL_TOKENS + DECODE_PASSES,
    ),
    conservationCheck(
      'cost_log_batch_self_consistency',
      'cost_log internal: Σ batch_tokens vs Σ(prefill_tokens + decode_request_count)',
      PREFILL_TOKENS + DECODE_PASSES,
      PREFILL_TOKENS + DECODE_PASSES,
    ),
  ],
  definitions: {
    boundary_allowance_note: 'positive-only allowance for DurationReached pipeline tails',
  },
};

/**
 * A copy of the report with one check broken, and `all_ok` follows.
 *
 * Exported because the interesting cases are all "one thing is wrong", and a
 * spec building them by hand would be free to write a summary its rows do not
 * support — which is a report the parser refuses, so the spec would be testing
 * the refusal rather than the panel.
 */
export function conservationWith(name: string, expected: number, actual: number) {
  const checks = RUN_CONSERVATION.checks.map((one) =>
    one.name === name ? conservationCheck(one.name, one.description, expected, actual) : one,
  );
  return {
    ...RUN_CONSERVATION,
    all_ok: checks.every((one) => one.status === 'OK'),
    checks,
  };
}

/** The one read the conservation panel makes. */
export async function serveRunConservation(
  page: Page,
  body: unknown = RUN_CONSERVATION,
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/workload-conservation/report*', (route) =>
    route.fulfill({ json: body }),
  );
}

/** The one read the throughput panel makes. */
export async function serveRunThroughput(
  page: Page,
  report: unknown = RUN_THROUGHPUT,
  payload: unknown = RUN_THROUGHPUT_SERIES,
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/throughput/report*', (route) =>
    route.fulfill({ json: report }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/throughput/payload*', (route) =>
    route.fulfill({ json: payload }),
  );
}

/** The one read the batch panels make, at the run and at a pool. */
export async function serveRunBatch(
  page: Page,
  report: unknown = RUN_BATCH,
  payload: unknown = RUN_BATCH_SERIES,
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/batch/report*', (route) =>
    route.fulfill({ json: report }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/batch/payload*', (route) =>
    route.fulfill({ json: payload }),
  );
}

/** The one read the utilization panels make, at any of their three depths. */
export async function serveRunUtilization(
  page: Page,
  report: unknown = RUN_UTILIZATION,
  payload: unknown = RUN_UTILIZATION_SERIES,
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/utilization/report*', (route) =>
    route.fulfill({ json: report }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/utilization/payload*', (route) =>
    route.fulfill({ json: payload }),
  );
}

/**
 * The one read the memory panels make, at the run and at a pool.
 *
 * `body` overrides the payload for the specs that need a differently-shaped run
 * — one with no capacity declared, or one predating the prefix-cache column —
 * without a second fixture that could drift from this one.
 */
export async function serveRunKvOccupancy(
  page: Page,
  report: unknown = RUN_KV_OCCUPANCY,
  payload: unknown = RUN_KV_OCCUPANCY_SERIES,
) {
  await page.route('**/api/analyzer/v1/runs/*/subjects/kv-occupancy/report*', (route) =>
    route.fulfill({ json: report }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/kv-occupancy/payload*', (route) =>
    route.fulfill({ json: payload }),
  );
}

/** The one read the queue panels make, at whichever depth the address names. */
export async function serveRunRequestState(
  page: Page,
  report: unknown = RUN_REQUEST_STATE,
  payload: unknown = RUN_REQUEST_STATE_SERIES,
): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/request-state/report*', (route) =>
    route.fulfill({ json: report }),
  );
  await page.route('**/api/analyzer/v1/runs/*/subjects/request-state/payload*', (route) =>
    route.fulfill({ json: payload }),
  );
}

/**
 * The two kernel-time reads a run page makes once the address names a worker.
 *
 * Separate from `serveRunPage` because the drill-down specs stub the rest
 * themselves — they assert on which addresses were asked for — and only need
 * the panel underneath their subject to stop complaining.
 */
export async function serveRunKernelTime(page: Page): Promise<void> {
  await page.route('**/api/analyzer/v1/runs/*/subjects/kernel-time-share/payload*', (route) =>
    route.fulfill({ json: RUN_KERNEL_TIME }),
  );
  await page.route(
    '**/api/analyzer/v1/runs/*/workers/*/*/subjects/kernel-time-share/payload*',
    (route) => {
      const path = new URL(route.request().url()).pathname.split('/');
      const worker = runWorkerKernelTime(
        path[path.indexOf('workers') + 1],
        path[path.indexOf('workers') + 2],
      );
      return worker === null
        ? route.fulfill({ status: 404, body: 'no such worker' })
        : route.fulfill({ json: worker });
    },
  );
}
