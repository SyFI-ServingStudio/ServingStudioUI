import { describe, expect, it } from 'vitest';

import type { RunLifecycle } from '../domain/artifacts';
import {
  CATALOG_POLL_INTERVAL_MS,
  descriptorPollInterval,
  LIFECYCLE_REFETCH_ON_WINDOW_FOCUS,
  NOT_STARTED_LIFECYCLE_POLL_INTERVAL_MS,
  PENDING_LIFECYCLE_POLL_INTERVAL_MS,
} from './lifecyclePolling';

function lifecycle(simulation: RunLifecycle['simulation'], analysis: RunLifecycle['analysis']) {
  return { lifecycle: { simulation, analysis } };
}

describe('descriptor lifecycle polling policy', () => {
  it('uses the fast cadence only while a producer stage is pending', () => {
    expect(descriptorPollInterval(lifecycle('pending', 'not_started'))).toBe(
      PENDING_LIFECYCLE_POLL_INTERVAL_MS,
    );
    expect(descriptorPollInterval(lifecycle('complete', 'pending'))).toBe(
      PENDING_LIFECYCLE_POLL_INTERVAL_MS,
    );
  });

  it('stops the timer when pending transitions to complete', () => {
    expect(descriptorPollInterval(lifecycle('complete', 'pending'))).toBe(
      PENDING_LIFECYCLE_POLL_INTERVAL_MS,
    );
    expect(descriptorPollInterval(lifecycle('complete', 'complete'))).toBe(false);
  });

  it('stops the timer after either stage fails', () => {
    expect(descriptorPollInterval(lifecycle('failed', 'not_started'))).toBe(false);
    expect(descriptorPollInterval(lifecycle('complete', 'failed'))).toBe(false);
    expect(descriptorPollInterval(lifecycle('failed', 'pending'))).toBe(false);
  });

  it('bounds not-started polling to the catalog foreground cadence', () => {
    expect(descriptorPollInterval(lifecycle('complete', 'not_started'))).toBe(
      NOT_STARTED_LIFECYCLE_POLL_INTERVAL_MS,
    );
    expect(NOT_STARTED_LIFECYCLE_POLL_INTERVAL_MS).toBe(CATALOG_POLL_INTERVAL_MS);
    expect(LIFECYCLE_REFETCH_ON_WINDOW_FOCUS).toBe('always');
  });

  it('does not schedule before a descriptor exists', () => {
    expect(descriptorPollInterval(undefined)).toBe(false);
  });
});
