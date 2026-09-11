/** Existing batch charts as location-first panel specifications. */
import { batchSeriesRef, topologyRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const poolBatchSpec: PanelSpec = {
  id: 'pool.batch',
  title: 'Batch composition',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool'],
  options: ['evidence-panel'],
  needs(location) {
    return [batchSeriesRef(location.ref), topologyRef(location.ref)];
  },
  load: () => import('./BatchPanel').then((module) => module.PoolBatchPanel),
};

export const workerBatchSpec: PanelSpec = {
  id: 'worker.batch',
  title: 'Batch composition',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['evidence-panel'],
  needs(location) {
    return [batchSeriesRef(location.ref), topologyRef(location.ref)];
  },
  load: () => import('./BatchPanel').then((module) => module.WorkerBatchPanel),
};
