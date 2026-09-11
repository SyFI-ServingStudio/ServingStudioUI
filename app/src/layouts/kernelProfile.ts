import type { LayoutSpec } from './types';

const PAGE = [
  { title: 'Kernel profile', heading: false, panels: ['kernel-profile.page'] },
] as const;

export const kernelProfileLayout: LayoutSpec = {
  kind: 'kernelProfile',
  sections: PAGE,
  modes: { 'kernel-profile-page': PAGE },
};
