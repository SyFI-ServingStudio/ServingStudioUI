import { runConcurrencyRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runTimelineSpec: PanelSpec = {
  id: 'run.timeline',
  title: 'Timeline',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: [],
  needs(location) {
    return [runConcurrencyRef(location.ref)];
  },
  load: () => import('./TimelinePanel').then((module) => module.RunTimelinePanel),
};
