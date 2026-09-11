/**
 * `worker.kernel-time-share` as data.
 *
 * Separate from the component so the registry can answer questions about this
 * panel — what it reads, which drill-down it needs — without pulling the
 * component, its chart code, or its schema into the entry bundle.
 */
import { kernelTimeShareRef, workerKernelTimeShareRef } from '../../artifacts';
import type { PanelSpec } from '../types';
import { workerOf } from '../coordinate';

export const workerKernelTimeShareSpec: PanelSpec = {
  id: 'worker.kernel-time-share',
  title: 'Kernel time',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool', 'worker'],
  options: ['evidence-panel'],
  needs(location) {
    const worker = workerOf(location.focus);
    if (worker === null) return [];
    // Both, always: the panel asks the result what workers exist before it
    // trusts what a worker read says about itself.
    return [kernelTimeShareRef(location.ref), workerKernelTimeShareRef(location.ref, worker)];
  },
  load: () => import('./KernelTimeSharePanel').then((module) => module.KernelTimeSharePanel),
};
