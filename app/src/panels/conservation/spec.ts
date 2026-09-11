/**
 * The conservation panel as data.
 *
 * One panel and no deeper ones: the checks are about the run's whole log, and
 * there is no per-pool version of "the tokens add up".
 *
 * No options either. There is nothing here for a reader to choose — a check
 * reconciles or it does not — and a control that hid the passing ones would be
 * a control that hid the count, which is the part that makes "all of them"
 * mean anything.
 */
import { conservationRef } from '../../artifacts';
import type { PanelSpec } from '../types';

export const runConservationSpec: PanelSpec = {
  id: 'run.checks',
  title: 'Workload conservation',
  mode: 'panel',
  kinds: ['run'],
  consumes: [],
  options: [],
  needs(location) {
    return [conservationRef(location.ref)];
  },
  load: () => import('./ConservationPanel').then((module) => module.RunConservationPanel),
};
