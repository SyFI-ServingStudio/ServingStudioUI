import { describe, expect, it } from 'vitest';

import { TEST_KERNEL_KINDS } from '../test/kernelKinds';
import { colors } from '../ui/theme';
import {
  familyColor,
  familyOf,
  kindColor,
  kindTitle,
  NO_KERNEL_KINDS,
  UNCLASSIFIED_FAMILY,
} from './kernelTaxonomy';

describe('kernel taxonomy', () => {
  it('names and groups a kind as its DOC does', () => {
    expect(familyOf(TEST_KERNEL_KINDS, 'rms_norm')).toBe('Normalization');
    expect(kindTitle(TEST_KERNEL_KINDS, 'rms_norm')).toBe('RMSNorm');
  });

  it("colours a family by its category's position in the served order", () => {
    TEST_KERNEL_KINDS.categories.forEach((category, position) =>
      expect(familyColor(TEST_KERNEL_KINDS, category)).toBe(colors.kernelFamilies[position]),
    );
    const reordered = { ...TEST_KERNEL_KINDS, categories: ['Normalization', 'GEMM'] };
    expect(kindColor(reordered, 'rms_norm')).toBe(colors.kernelFamilies[0]);
    expect(kindColor(reordered, 'single_gemm')).toBe(colors.kernelFamilies[1]);
  });

  it('gives every family a colour no other family and no unclassified kind has', () => {
    const many = {
      categories: Array.from({ length: colors.kernelFamilies.length * 2 }, (_, i) => `c${i}`),
      kinds: {},
    };
    const drawn = many.categories.map((category) => familyColor(many, category));
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).not.toContain(colors.unclassifiedKernel);
  });

  it('draws a kind no DOC names under its own name, unclassified', () => {
    for (const kinds of [TEST_KERNEL_KINDS, NO_KERNEL_KINDS]) {
      expect(familyOf(kinds, 'not_a_kind')).toBe(UNCLASSIFIED_FAMILY);
      expect(kindTitle(kinds, 'not_a_kind')).toBe('not_a_kind');
      expect(kindColor(kinds, 'not_a_kind')).toBe(colors.unclassifiedKernel);
    }
  });
});
