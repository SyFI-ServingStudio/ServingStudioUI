/**
 * The worker a focus names, if it names one.
 *
 * A worker id alone is not a worker: ids repeat across pools, so the pool
 * segment must be present too. Reading both from the path — rather than from
 * two independent fields — is what makes that impossible to get half right.
 *
 * It sits directly under `src/panels`, beside the registry, because two panels
 * now read a worker out of the address and a panel may not import another
 * panel. A spec needs it too, and a spec must not import its own component.
 */
import type { WorkerCoordinate } from '../artifacts';
import { segmentOf, type Focus } from '../location';

export function workerOf(focus: Focus): WorkerCoordinate | null {
  const pool = segmentOf(focus.path, 'pool');
  const worker = segmentOf(focus.path, 'worker');
  if (pool === null || worker === null) return null;
  return { poolTag: pool.role, workerId: worker.id };
}
