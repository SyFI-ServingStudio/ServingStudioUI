import type { WorkerKey, WorkerRef } from './worker';
import type { Deployment } from './deployment';

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
  workerSeries: {
    key: WorkerKey;
    label: string;
    worker: WorkerRef;
    util: number[];
  }[];
}
export interface KvSeries {
  t_ms: number[];
  series: {
    key: string;
    label: string;
    poolTag?: string;
    /** Older analyzer runs may retain raw KV tokens without a capacity snapshot. */
    capacity: number | null;
    active: number[];
  }[];
  workerSeries: {
    key: WorkerKey;
    label: string;
    worker: WorkerRef;
    /** Workers inherit the static per-shard capacity of their pool series. */
    capacity: number | null;
    active: number[];
  }[];
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
export interface RunSource {
  kind: 'synthetic' | 'analyzer_fixture' | 'analyzer_http';
  simulationFolder: string;
  /** `null` means the repository has no execution-session evidence. */
  simulationReexecuted: boolean | null;
}

/** Core-level resource gates. Optional Analyzer subjects and worker details
 * keep their own explicit status instead of being duplicated as booleans. */
export interface RunCapabilities {
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
  maxBatchTokens?: number;
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
}

/** Bounded run facts assembled only from descriptor, summary, and topology.
 * Optional analyzer subjects keep their own query/status identity and must not
 * be copied into this long-lived core model. */
export interface Run {
  id: string;
  name: string;
  model: string;
  deployment: Deployment;
  gpu: string;
  summary: Summary;
  topology: Topology;
  workerList: WorkerRow[];
  gpuTotal: number;
  source: RunSource;
  capabilities: RunCapabilities;
}
