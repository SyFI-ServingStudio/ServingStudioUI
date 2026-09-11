import { sweepAnalysisRef } from '../../artifacts';
import type { ContentPanelSpec } from '../types';

export const sweepPageSpec = {
  id: 'sweep.page',
  title: 'Sweep aggregate',
  mode: 'panel',
  scope: false,
  kinds: ['sweep'],
  consumes: [],
  options: ['metric', 'stat', 'evidence-panel'],
  needs: (location) =>
    location.ref.kind === 'sweep'
      ? [sweepAnalysisRef({ ...location.ref, kind: 'sweep' as const })]
      : [],
  load: async () => (await import('./SweepPage')).SweepPage,
} satisfies ContentPanelSpec;
