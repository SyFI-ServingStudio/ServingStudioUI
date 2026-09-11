import { runLatencyRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runSloSpec: PanelSpec = {
  id: 'run.slo',
  title: 'Latency',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: ['evidence-panel'],
  needs(location) {
    return [runLatencyRef(location.ref)];
  },
  load: () => import('./SloPanel').then((module) => module.RunSloPanel),
};
