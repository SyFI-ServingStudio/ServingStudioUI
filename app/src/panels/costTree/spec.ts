/** The worker iteration view is a page mode, not a detached citation panel. */
import { runDescriptorRef } from '../../artifacts';
import type { PanelSpec } from '../types';
import { workerOf } from '../coordinate';

export const workerCostTreePageSpec: PanelSpec = {
  id: 'worker.cost-tree',
  title: 'Iteration detail',
  mode: 'page',
  layoutMode: 'worker-workbench',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: [],
  needs(location) {
    if (location.ref.kind !== 'run' || workerOf(location.focus) === null) return [];
    return [runDescriptorRef({ ...location.ref, kind: 'run' })];
  },
};
