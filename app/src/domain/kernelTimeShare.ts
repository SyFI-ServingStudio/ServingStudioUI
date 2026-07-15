import type { WorkerKey, WorkerRef } from './worker';

/** UI-independent projection of analyzer `kernel-time-share` schema v1. */
export interface KernelTimeSegment {
  position: string;
  kind: string;
  kernelTimeMs: number;
  sharePct: number;
}

export interface KernelTimeComposition {
  kernelTimeMs: number;
  segments: KernelTimeSegment[];
}

export interface KernelTimePoolComposition extends KernelTimeComposition {
  poolTag: string;
  numWorkers: number;
}

export interface KernelTimeWorkerComposition extends KernelTimeComposition {
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
  overall: KernelTimeComposition;
  pools: KernelTimePoolComposition[];
  workers: KernelTimeWorkerComposition[];
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
