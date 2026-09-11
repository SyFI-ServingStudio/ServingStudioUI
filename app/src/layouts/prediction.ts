import type { LayoutSpec } from './types';

const PAGE = [{ title: 'Timing prediction', heading: false, panels: ['prediction.page'] }] as const;

export const predictionLayout: LayoutSpec = {
  kind: 'prediction',
  sections: PAGE,
  modes: { 'prediction-page': PAGE },
};
