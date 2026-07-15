import type { RunDescriptor, RunLifecycle } from '../domain/artifacts';

/** Catalog discovery is deliberately low-rate: descriptor polling owns the
 * fast path once a run is selected. Both reads stay conditional at transport. */
export const CATALOG_POLL_INTERVAL_MS = 30_000;

/** A pending stage is active producer work, so this is the only fast cadence. */
export const PENDING_LIFECYCLE_POLL_INTERVAL_MS = 2_000;

/** `not_started` may be the short launcher hand-off race or an intentional
 * `--no-analyze` run. Reusing the catalog cadence bounds the idle request rate. */
export const NOT_STARTED_LIFECYCLE_POLL_INTERVAL_MS = CATALOG_POLL_INTERVAL_MS;

/** Focus must bypass the global 30-second stale window: a background run may
 * have completed while the user was away. HTTP still sends If-None-Match. */
export const LIFECYCLE_REFETCH_ON_WINDOW_FOCUS = 'always' as const;

export type LifecyclePollInterval = number | false;

/** Pure policy shared by the query hook and tests. A failure wins over any
 * malformed mixed state; retrying a failed producer requires focus or a later
 * explicit invalidation, not an endless timer. */
export function descriptorPollInterval(
  descriptor: Pick<RunDescriptor, 'lifecycle'> | undefined,
): LifecyclePollInterval {
  if (descriptor === undefined) return false;

  const { simulation, analysis }: RunLifecycle = descriptor.lifecycle;
  if (simulation === 'failed' || analysis === 'failed') return false;
  if (simulation === 'pending' || analysis === 'pending') {
    return PENDING_LIFECYCLE_POLL_INTERVAL_MS;
  }
  if (simulation === 'not_started' || analysis === 'not_started') {
    return NOT_STARTED_LIFECYCLE_POLL_INTERVAL_MS;
  }
  return false;
}
