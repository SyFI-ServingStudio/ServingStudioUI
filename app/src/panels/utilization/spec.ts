/**
 * The existing utilization timeline at each location depth.
 *
 * All three panels read the complete payload and filter it locally, preserving
 * the old run, pool, and worker charts while location `consumes` controls which
 * panel applies. The report remains a separate artifact for non-chart readers.
 */
import { utilizationSeriesRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runUtilizationSpec: PanelSpec = {
  id: 'run.utilization',
  title: 'Utilization',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: ['evidence-panel'],
  needs(location) {
    return [utilizationSeriesRef(location.ref)];
  },
  load: () => import('./UtilizationPanel').then((module) => module.RunUtilizationPanel),
};

export const poolUtilizationSpec: PanelSpec = {
  id: 'pool.utilization',
  title: 'Utilization',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool'],
  options: ['evidence-panel'],
  needs(location) {
    return [utilizationSeriesRef(location.ref)];
  },
  load: () => import('./UtilizationPanel').then((module) => module.PoolUtilizationPanel),
};

export const workerUtilizationSpec: PanelSpec = {
  id: 'worker.utilization',
  title: 'Utilization',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['evidence-panel'],
  needs(location) {
    return [utilizationSeriesRef(location.ref)];
  },
  load: () => import('./UtilizationPanel').then((module) => module.WorkerUtilizationPanel),
};
