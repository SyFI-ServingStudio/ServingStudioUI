/** Existing request-state charts as location-first panel specifications. */
import { requestStateSeriesRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runRequestStateSpec: PanelSpec = {
  id: 'run.queue',
  title: 'Request state',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: ['evidence-panel'],
  needs(location) {
    return [requestStateSeriesRef(location.ref)];
  },
  load: () => import('./RequestStatePanel').then((module) => module.RunRequestStatePanel),
};

export const poolRequestStateSpec: PanelSpec = {
  id: 'pool.queue',
  title: 'Request state',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool'],
  options: ['evidence-panel'],
  needs(location) {
    return [requestStateSeriesRef(location.ref)];
  },
  load: () => import('./RequestStatePanel').then((module) => module.PoolRequestStatePanel),
};

export const workerRequestStateSpec: PanelSpec = {
  id: 'worker.queue',
  title: 'Request state',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['evidence-panel'],
  needs(location) {
    return [requestStateSeriesRef(location.ref)];
  },
  load: () => import('./RequestStatePanel').then((module) => module.WorkerRequestStatePanel),
};
