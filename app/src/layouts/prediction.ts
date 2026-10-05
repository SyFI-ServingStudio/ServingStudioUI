import { RESULT_TITLE } from '../panels/resultTitle';
import type { LayoutSpec } from './types';

const PAGE = [
  { title: RESULT_TITLE.prediction, heading: false, panels: ['prediction.page'] },
] as const;

export const predictionLayout: LayoutSpec = {
  kind: 'prediction',
  sections: PAGE,
  modes: { 'prediction-page': PAGE },
};
