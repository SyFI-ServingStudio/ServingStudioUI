import type { CostNode } from '../data/tree';
import type { KernelTimeShare } from './kernelTimeShare';
import type { WorkerKey, WorkerRef } from './worker';

// Analyzer-derived metric models. Transport DTOs remain snake_case in
// contracts/; repositories map them into these UI-independent domain shapes.
export interface SloMetric {
  label: string;
  unit: string;
  x: number[];
  y_pct: number[];
  markers: { p50: number; p90: number; p99: number };
}
export interface Slo {
  ttft: SloMetric;
  tpot: SloMetric;
  e2e: SloMetric;
}
export interface Throughput {
  t_start_ms: number[];
  t_end_ms: number[];
  total: number[];
  prefill: number[];
  decode: number[];
}
export interface UtilSeries {
  t_ms: number[];
  series: { key: string; label: string; poolTag?: string; util: number[] }[];
}
export interface KvSeries {
  t_ms: number[];
  series: { label: string; poolTag?: string; capacity: number; active: number[] }[];
}
export interface Concurrency {
  t_ms: number[];
  active: number[];
  peak: number;
}

export interface PendingQueueSeries {
  key: WorkerKey;
  worker: WorkerRef;
  pending: number[];
}
export interface PendingQueue {
  t_ms: number[];
  series: PendingQueueSeries[];
}
export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface ConservationCheck {
  name: string;
  description: string;
  actual: number;
  expected: number;
  deltaPct: number;
  status: CheckStatus;
}
export interface Conservation {
  allOk: boolean;
  checks: ConservationCheck[];
}
export interface BatchSeries {
  t_ms: number[];
  batchTokens: number[];
  prefillTokens: number[];
  decodeRequests: number[];
}
export interface BatchSubject {
  pools: Readonly<Record<string, BatchSeries>>;
}
export interface Payloads {
  slo: Slo;
  throughput: Throughput;
  utilization: UtilSeries;
  kv: KvSeries;
  concurrency?: Concurrency;
  pendingQueue?: PendingQueue;
  batchByPool?: Readonly<Record<string, BatchSeries>>;
  conservation?: Conservation;
  /** Raw analyzer-v1 payload stays opaque until its subject adapter lands. */
  kernelInputDistribution?: unknown;
  kernelTimeShare?: KernelTimeShare;
}

export interface RunSource {
  kind: 'synthetic' | 'analyzer_fixture' | 'analyzer_http';
  simulationFolder: string;
  /** `null` means the repository has no execution-session evidence. */
  simulationReexecuted: boolean | null;
}

/** Explicit capability gates prevent a missing analyzer artifact from quietly
 * falling back to a synthetic generator in production-facing components. */
export interface RunCapabilities {
  traceOverview: boolean;
  concurrencyTimeline: boolean;
  workerIterations: boolean;
  kernelPerformance: boolean;
  kernelInputDistribution: boolean;
  loadImbalance: boolean;
  perfettoTrace: boolean;
}

export interface Arch {
  type: string;
  model: string;
  params: Record<string, number | string>;
}
/** Older analyzer runs do not persist every worker preset field. Missing
 * metadata remains absent instead of being reconstructed from assumptions. */
export interface WorkerCfg {
  type: string;
  memGb?: number;
  mult?: number;
}
export interface WorkerInstance {
  id: string;
  gpus: number[];
  dp?: number;
}
export interface Group {
  gpu: string;
  replicas: number;
  gpusPerReplica: number;
  numGpus: number;
  arch: Arch;
  worker: WorkerCfg;
  workers: WorkerInstance[];
}
export interface Pool {
  role: string;
  placement: string;
  groups: Group[];
}
export interface Topology {
  pools: Pool[];
}

export interface Summary {
  total_tok_s: number;
  num_gpus: number;
  requests: number;
  requests_total?: number;
  ttft_p50: number;
  tpot_p50: number;
  e2e_p50: number;
}
export interface WorkerRow {
  key: WorkerKey;
  ref: WorkerRef;
  id: string;
  pool: string;
  workerType: string;
  archType: string;
  gpu: string;
  gpuCount: number;
  gpus: number[];
  dp: number | null;
  arch: Arch;
  worker: WorkerCfg;
  tree: CostNode;
}

/**
 * Transitional assembled view of one run. Repositories will eventually load
 * its descriptor and subjects independently; keeping this type explicit makes
 * the current synchronous fixture path removable without leaking wire JSON.
 */
export interface Run {
  id: string;
  name: string;
  model: string;
  deployment: 'unified' | 'afd';
  gpu: string;
  summary: Summary;
  topology: Topology;
  trees: Record<WorkerKey, CostNode>;
  payloads: Payloads;
  workerList: WorkerRow[];
  gpuTotal: number;
  source: RunSource;
  capabilities: RunCapabilities;
}
