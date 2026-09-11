import { alignmentDescriptorRef } from '../../artifacts';
import type { ContentPanelSpec } from '../types';

export const alignmentPageSpec = {
  id: 'alignment.page',
  title: 'Alignment',
  mode: 'panel',
  scope: false,
  kinds: ['alignment'],
  consumes: [],
  options: [],
  needs: (location) => {
    if (location.ref.kind !== 'alignment') return [];
    const result = { ...location.ref, kind: 'alignment' as const };
    return [alignmentDescriptorRef(result)];
  },
  load: async () => (await import('./AlignmentPage')).AlignmentPage,
} satisfies ContentPanelSpec;
