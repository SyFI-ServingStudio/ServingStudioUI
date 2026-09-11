import { runDescriptorRef, topologyRef } from '../../artifacts';
import type { PanelSpec } from '../types';
import { workerOf } from '../coordinate';

/**
 * The iteration workbench owns the exact-operation timeline and, in the next
 * slice, its CostTree and inspector. The operation sequence is a dependent
 * read: only the descriptor can supply its analysis revision, so needs()
 * declares the descriptor gate and the component constructs the pinned
 * sequence after that gate resolves.
 */
export const workerIterationWorkbenchSpec: PanelSpec = {
  id: 'worker.iteration-workbench',
  title: 'Worker iteration detail',
  mode: 'panel',
  scope: false,
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['cost-tree-scope', 'evidence-panel'],
  needs(location) {
    if (location.ref.kind !== 'run' || workerOf(location.focus) === null) return [];
    return [
      runDescriptorRef({ ...location.ref, kind: 'run' }),
      topologyRef({ ...location.ref, kind: 'run' }),
    ];
  },
  load: () => import('./WorkerWorkbenchPanel').then((module) => module.WorkerWorkbenchPanel),
};
