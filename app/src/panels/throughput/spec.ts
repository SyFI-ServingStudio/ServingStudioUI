/**
 * The throughput panel as data.
 *
 * One panel, and no deeper ones. The producer differences a single aggregate
 * column per snapshot tick, so the subject is cluster-wide by construction:
 * there is no per-pool throughput in the document, and a `pool.throughput` spec
 * would be an address that resolves to a panel with nothing to put in it.
 *
 * No options either. The document publishes two views of the same tokens — the
 * measured intervals and a ≤10-bin smoothing of them — and this build reads the
 * intervals. That is not a choice for the reader to make: the bins are the same
 * measurement with detail removed, so offering both would offer a way to see
 * less and call it a preference.
 */
import { throughputSeriesRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runThroughputSpec: PanelSpec = {
  id: 'run.throughput',
  title: 'Throughput',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: ['evidence-panel'],
  needs(location) {
    return [throughputSeriesRef(location.ref)];
  },
  load: () => import('./ThroughputPanel').then((module) => module.RunThroughputPanel),
};
