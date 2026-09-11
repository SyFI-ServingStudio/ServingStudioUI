import { kernelProfileCurveRef, kernelProfileDescriptorRef } from '../../artifacts';
import type { ContentPanelSpec, PageModeSpec } from '../types';

export const kernelProfilePageSpec = {
  id: 'kernel-profile.page',
  title: 'Kernel profile',
  mode: 'panel',
  scope: false,
  kinds: ['kernelProfile'],
  consumes: [],
  options: ['metric'],
  needs: (location) => {
    if (location.ref.kind !== 'kernelProfile') return [];
    const result = { ...location.ref, kind: 'kernelProfile' as const };
    return [kernelProfileDescriptorRef(result), kernelProfileCurveRef(result)];
  },
  load: async () => (await import('./KernelProfilePage')).KernelProfilePage,
} satisfies ContentPanelSpec;

/** Frozen Agent citations use the old panel id `curve`; it selects the full page. */
export const kernelProfileCurveModeSpec = {
  id: 'curve',
  title: 'Kernel profile curve',
  mode: 'page',
  layoutMode: 'kernel-profile-page',
  kinds: ['kernelProfile'],
  consumes: [],
  options: ['metric'],
  needs: kernelProfilePageSpec.needs,
} satisfies PageModeSpec;
