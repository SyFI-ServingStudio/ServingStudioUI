import { describe, expect, it } from 'vitest';

import { TEST_KERNEL_KINDS } from '../test/kernelKinds';
import { colors } from '../ui/theme';
import { familyOf, kindColor, kindTitle, NO_KERNEL_KINDS, OTHER_FAMILY } from './kernelTaxonomy';

describe('kernel taxonomy', () => {
  it('names and groups a kind as its DOC does', () => {
    expect(familyOf(TEST_KERNEL_KINDS, 'rms_norm')).toBe('Normalization');
    expect(kindTitle(TEST_KERNEL_KINDS, 'rms_norm')).toBe('RMSNorm');
    expect(kindColor(TEST_KERNEL_KINDS, 'single_gemm')).toBe(colors.gemm);
  });

  it('draws a kind no DOC names under its own name in Other', () => {
    for (const kinds of [TEST_KERNEL_KINDS, NO_KERNEL_KINDS]) {
      expect(familyOf(kinds, 'not_a_kind')).toBe(OTHER_FAMILY);
      expect(kindTitle(kinds, 'not_a_kind')).toBe('not_a_kind');
      expect(kindColor(kinds, 'not_a_kind')).toBe(colors.other);
    }
  });
});
