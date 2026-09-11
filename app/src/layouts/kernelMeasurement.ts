import type { LayoutSpec } from './types';

const PAGE = [
  { title: 'Kernel measurement', heading: false, panels: ['kernel-measurement.page'] },
] as const;

export const kernelMeasurementLayout: LayoutSpec = {
  kind: 'kernelMeasurement',
  sections: PAGE,
  modes: { 'kernel-measurement-page': PAGE },
};
