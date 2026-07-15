import type { WorkerKey, WorkerRef } from './worker';

/** Analyzer threshold below which a scope has no reportable kernel time. */
export const KERNEL_TIME_EPSILON_MS = 1e-12;

/** UI-independent projection of analyzer `kernel-time-share` schema v1. */
export interface KernelTimeSegment {
  position: string;
  kind: string;
  kernelTimeMs: number;
  sharePct: number;
}

/** A bounded run-level projection. It is not a hierarchical CostTree detail. */
export interface AggregateKernelComposition {
  kernelTimeMs: number;
  segments: KernelTimeSegment[];
}

export interface AggregatePoolKernelComposition extends AggregateKernelComposition {
  poolTag: string;
  numWorkers: number;
}

export interface AggregateWorkerKernelComposition extends AggregateKernelComposition {
  ref: WorkerRef;
  key: WorkerKey;
  rawRows: number;
  sampledRows: number;
  sampleStride: number;
}

export interface KernelTimePosition {
  name: string;
  kind: string;
  overallSharePct: number;
}

export interface KernelTimeShare {
  overall: AggregateKernelComposition;
  pools: AggregatePoolKernelComposition[];
  workers: AggregateWorkerKernelComposition[];
  positions: KernelTimePosition[];
  /** Scope totals are exact even when the position mixture is sampled. */
  kernelTimeTotalsExact: true;
  sampling: {
    positionMixExact: boolean;
    method: string;
    rawRows: number;
    sampledRows: number;
    maxReplayRowsTarget: number;
  };
  definitions: Readonly<Record<string, string>>;
}
