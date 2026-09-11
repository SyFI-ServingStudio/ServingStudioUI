/**
 * The run headline, declared without loading it.
 *
 * `needs` returns the six existing-overview reads at every run address: this
 * panel is the top of the page and applies wherever a run does, so there is no
 * path condition to check. It consumes nothing, which is what says it stays on
 * screen as the reader drills into a pool or a worker — the run's identity,
 * workload and headline results remain the context for every depth.
 */
import {
  catalogRef,
  runLatencyRef,
  runModelRef,
  runSummaryRef,
  runWorkloadRef,
  topologyRef,
} from '../../artifacts';
import type { PanelSpec } from '../types';

export const runHeadlineSpec: PanelSpec = {
  id: 'run.headline',
  title: 'Run headline',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: [],
  needs(location) {
    return [
      runSummaryRef(location.ref),
      runLatencyRef(location.ref),
      topologyRef(location.ref),
      runModelRef(location.ref),
      runWorkloadRef(location.ref),
      catalogRef(location.ref.workspace, 'run'),
    ];
  },
  load: () => import('./HeadlinePanel').then((module) => module.HeadlinePanel),
};
