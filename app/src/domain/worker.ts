/**
 * Stable worker identity shared by selection state, caches and repository keys.
 * Analyzer worker ids are only unique inside a pool, so callers must never key
 * worker-owned data by `workerId` alone.
 */
export interface WorkerRef {
  poolTag: string;
  workerId: string;
}

declare const workerKeyBrand: unique symbol;
export type WorkerKey = string & { readonly [workerKeyBrand]: true };

export function makeWorkerRef(poolTag: string, workerId: string | number): WorkerRef {
  return { poolTag, workerId: String(workerId) };
}

/** Encode both components so the separator remains unambiguous. */
export function makeWorkerKey(poolTag: string, workerId: string | number): WorkerKey;
export function makeWorkerKey(worker: WorkerRef): WorkerKey;
export function makeWorkerKey(poolOrWorker: string | WorkerRef, workerId?: string | number): WorkerKey {
  const worker = typeof poolOrWorker === 'string'
    ? makeWorkerRef(poolOrWorker, workerId ?? '')
    : poolOrWorker;
  return `${encodeURIComponent(worker.poolTag)}/${encodeURIComponent(worker.workerId)}` as WorkerKey;
}

export function sameWorker(left: WorkerRef, right: WorkerRef): boolean {
  return left.poolTag === right.poolTag && left.workerId === right.workerId;
}
