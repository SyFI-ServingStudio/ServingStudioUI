import { kernelMeasurementDescriptorRef, kernelMeasurementSummaryRef } from '../../artifacts';
import type { ContentPanelSpec, PageModeSpec } from '../types';

export const kernelMeasurementPageSpec = {
  id: 'kernel-measurement.page',
  title: 'Kernel measurement',
  mode: 'panel',
  scope: false,
  kinds: ['kernelMeasurement'],
  consumes: [],
  options: ['metric', 'plot'],
  needs: (location) => {
    if (location.ref.kind !== 'kernelMeasurement') return [];
    const result = { ...location.ref, kind: 'kernelMeasurement' as const };
    return [kernelMeasurementDescriptorRef(result), kernelMeasurementSummaryRef(result)];
  },
  load: async () => (await import('./KernelMeasurementPage')).KernelMeasurementPage,
} satisfies ContentPanelSpec;

export const kernelMeasurementSummaryModeSpec = {
  id: 'summary',
  title: 'Kernel measurement summary',
  mode: 'page',
  layoutMode: 'kernel-measurement-page',
  kinds: ['kernelMeasurement'],
  consumes: [],
  options: ['metric'],
  needs: kernelMeasurementPageSpec.needs,
} satisfies PageModeSpec;

export const kernelMeasurementPlotModeSpec = {
  id: 'plot',
  title: 'Kernel measurement plot',
  mode: 'page',
  layoutMode: 'kernel-measurement-page',
  kinds: ['kernelMeasurement'],
  consumes: [],
  options: ['plot'],
  needs: kernelMeasurementPageSpec.needs,
} satisfies PageModeSpec;
