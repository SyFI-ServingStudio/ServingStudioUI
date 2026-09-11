import {
  iterationOptimalityKernelLadderRef,
  iterationOptimalityWaterfallRef,
  runDescriptorRef,
  runOptimalityRef,
} from '../../artifacts';
import { segmentOf } from '../../location';
import { workerOf } from '../coordinate';
import type { ContentPanelSpec } from '../types';

export const runOptimalitySpec = {
  id: 'run.optimality',
  title: 'Optimality analysis',
  mode: 'panel',
  scope: false,
  kinds: ['run'],
  consumes: [],
  options: ['optimality', 'evidence-panel'],
  needs(location) {
    if (location.ref.kind !== 'run') return [];
    const run = location.ref as typeof location.ref & { readonly kind: 'run' };
    const mode = location.focus.options.optimality === 'batch_locked' ? 'batch_locked' : 'unlocked';
    const refs = [runDescriptorRef(run), runOptimalityRef(run, mode)];
    const operation = segmentOf(location.focus.path, 'operation');
    const worker = workerOf(location.focus);
    return operation === null || worker === null
      ? refs
      : [
          ...refs,
          iterationOptimalityKernelLadderRef(run, worker, operation.iter, mode),
          iterationOptimalityWaterfallRef(run, worker, operation.iter, mode),
        ];
  },
  load: () => import('./OptimalityPanel').then((module) => module.RunOptimalityPanel),
} satisfies ContentPanelSpec;
