import { describe, expect, it } from 'vitest';

import { costTreeDisplayLabel } from './costTree';

describe('CostTree display labels', () => {
  it('hides generated worklet type and configuration metadata', () => {
    expect(
      costTreeDisplayLabel(
        'afd.moe_expert_compute (MoeExpertComputeLocalWorklet) [hidden=6144, m_inter=2560, experts_per_gpu=20/160]',
      ),
    ).toBe('afd.moe_expert_compute');
  });

  it('preserves ordinary human-authored labels', () => {
    expect(costTreeDisplayLabel('attention branches')).toBe('attention branches');
  });
});
