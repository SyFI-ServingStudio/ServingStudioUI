import { describe, expect, it } from 'vitest';

import { parseKernelKinds } from './kernelKinds';

const BODY = {
  schema_version: 1,
  categories: ['GEMM', 'Other'],
  kinds: { single_gemm: { title: 'Dense GEMM', category: 'GEMM' } },
};

describe('parseKernelKinds', () => {
  it('keeps each kind DOC title and category and the category order', () => {
    expect(parseKernelKinds(BODY)).toEqual({
      categories: ['GEMM', 'Other'],
      kinds: { single_gemm: { title: 'Dense GEMM', category: 'GEMM' } },
    });
  });

  it('refuses a kind filed under a category the read does not list', () => {
    expect(() =>
      parseKernelKinds({ ...BODY, kinds: { x: { title: 'X', category: 'Routing' } } }),
    ).toThrow(/category Routing/);
    expect(() => parseKernelKinds({ ...BODY, schema_version: 2 })).toThrow();
  });
});
