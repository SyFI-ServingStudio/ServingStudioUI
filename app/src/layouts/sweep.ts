import type { LayoutSpec } from './types';

export const sweepLayout: LayoutSpec = {
  kind: 'sweep',
  sections: [{ title: 'Sweep aggregate', heading: false, panels: ['sweep.page'] }],
};
