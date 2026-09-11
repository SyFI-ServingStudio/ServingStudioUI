/** Existing pool and worker KV timelines as location-addressed panels. */
import { kvOccupancySeriesRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const poolMemorySpec: PanelSpec = {
  id: 'pool.kv',
  title: 'KV memory',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool'],
  options: ['evidence-panel'],
  needs(location) {
    return [kvOccupancySeriesRef(location.ref)];
  },
  load: () => import('./MemoryPanel').then((module) => module.PoolMemoryPanel),
};

export const workerMemorySpec: PanelSpec = {
  id: 'worker.kv',
  title: 'KV occupancy',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['evidence-panel'],
  needs(location) {
    return [kvOccupancySeriesRef(location.ref)];
  },
  load: () => import('./MemoryPanel').then((module) => module.WorkerMemoryPanel),
};
