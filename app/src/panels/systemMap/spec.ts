/**
 * `run.system-map` as data.
 *
 * `consumes` is empty on purpose, and it is the load-bearing part of this file.
 * This panel is how a reader *reaches* a pool or a worker, so a rule that
 * required one to be on the path already would remove the map from exactly the
 * address where it is needed — and, because `consumes` is also the pruning
 * rule, would drop it from the URL on the way back up out of a worker.
 */
import { runModelRef, topologyRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const systemMapSpec: PanelSpec = {
  id: 'run.system-map',
  title: 'System map',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: [],
  needs(location) {
    return [topologyRef(location.ref), runModelRef(location.ref)];
  },
  load: () => import('./SystemMapPanel').then((module) => module.SystemMapPanel),
};
