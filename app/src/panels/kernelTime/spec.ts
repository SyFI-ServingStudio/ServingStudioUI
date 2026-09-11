/**
 * The two kernel-time panels as data.
 *
 * Both read the one cluster document — it carries `overall`, every pool in
 * full, and the worker index — so neither adds a request to the page that the
 * other has not already made.
 *
 * They differ only in `consumes`, and that is what makes the drill-down work:
 * the run panel applies everywhere, the pool panel only where a pool is on the
 * path, and navigating up out of a pool drops the pool panel from the address
 * rather than leaving it there to say "no such pool".
 */
import { kernelTimeShareRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runKernelTimeSpec: PanelSpec = {
  id: 'run.kernel-time',
  title: 'Kernel time',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: ['evidence-panel'],
  needs(location) {
    return [kernelTimeShareRef(location.ref)];
  },
  load: () => import('./KernelTimePanel').then((module) => module.RunKernelTimePanel),
};

export const poolKernelTimeSpec: PanelSpec = {
  id: 'pool.kernel-time',
  title: 'Kernel time',
  mode: 'panel',
  kinds: ['run'],
  consumes: ['pool'],
  options: ['evidence-panel'],
  needs(location) {
    return [kernelTimeShareRef(location.ref)];
  },
  load: () => import('./KernelTimePanel').then((module) => module.PoolKernelTimePanel),
};
