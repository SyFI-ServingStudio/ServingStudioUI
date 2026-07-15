import { describe, expect, it } from 'vitest';

import {
  annotate,
  leaf,
  leafById,
  leafByName,
  leafTotals,
  max,
  nodeById,
  scale,
  sum,
  CostTreeValidationError,
} from './tree';

describe('CostTree annotation', () => {
  it('annotates all four node kinds with finite preorder metadata and costs', () => {
    const tree = annotate(
      sum(
        'root',
        leaf('root.a', 'single_gemm', '{}', 2),
        max(
          'parallel',
          1,
          leaf('root.b', 'all_reduce', '{}', 3),
          scale('layers', 2, leaf('root.c', 'rms_norm', '{}', 1)),
        ),
      ),
    );

    expect(tree).toMatchObject({ kind: 'sum', id: 0, depth: 0, ms: 5, pct: 100, totalMs: 5 });
    if (tree.kind !== 'sum') throw new Error('Expected the test root to be Sum.');
    const [leafA, parallel] = tree.children;
    expect(leafA).toMatchObject({ kind: 'leaf', id: 1, depth: 1, ms: 2 });
    expect(leafA.pct).toBeCloseTo(40);
    expect(parallel).toMatchObject({ kind: 'max', id: 2, depth: 1, ms: 3 });
    expect(parallel.pct).toBeCloseTo(60);
    if (parallel.kind !== 'max') throw new Error('Expected the second child to be Max.');
    expect(parallel.children[0]).toMatchObject({ kind: 'leaf', id: 3, depth: 2, ms: 3 });
    const repeated = parallel.children[1];
    expect(repeated).toMatchObject({ kind: 'scale', id: 4, depth: 2, ms: 2 });
    if (repeated.kind !== 'scale') throw new Error('Expected the second Max branch to be Scale.');
    expect(repeated.children[0]).toMatchObject({ kind: 'leaf', id: 5, depth: 3, ms: 1 });
    expect(repeated.children[0].pct).toBeCloseTo(20);
    [tree, ...tree.children, ...parallel.children, repeated.children[0]].forEach((node) => {
      expect(Number.isFinite(node.ms)).toBe(true);
      expect(Number.isFinite(node.pct)).toBe(true);
    });
  });

  it('leaves raw authoring data untouched and returns a deeply frozen copy', () => {
    const raw = {
      kind: 'sum',
      label: 'mutable input',
      children: [
        {
          kind: 'leaf',
          slot: { name: 'a', kind: 'single_gemm', config: '{}', backend: null },
          base: 1,
        },
      ],
    };
    const before = structuredClone(raw);

    const tree = annotate(raw);

    expect(raw).toEqual(before);
    expect(tree).not.toBe(raw);
    expect('id' in raw).toBe(false);
    expect(Object.isFrozen(tree)).toBe(true);
    if (tree.kind !== 'sum') throw new Error('Expected a Sum root.');
    expect(Object.isFrozen(tree.children)).toBe(true);
    expect(Object.isFrozen(tree.children[0])).toBe(true);
    const child = tree.children[0];
    if (child.kind !== 'leaf') throw new Error('Expected a Leaf child.');
    expect(Object.isFrozen(child.slot)).toBe(true);
  });

  it('returns precise leaf types and stable derived busy-time totals', () => {
    const tree = annotate(
      scale(
        'twice',
        2,
        sum('body', leaf('gemm', 'single_gemm', '{}', 2), leaf('comm', 'all_reduce', '{}', 1)),
      ),
    );

    expect(leafById(tree, 2)?.slot.name).toBe('gemm');
    expect(leafByName(tree, 'comm')?.slot.kind).toBe('all_reduce');
    expect(nodeById(tree, 1)?.kind).toBe('sum');
    expect(leafById(tree, 1)).toBeNull();
    const totals = leafTotals(tree);
    expect(totals).toMatchObject({
      totalMs: 6,
      positions: [
        { name: 'gemm', ms: 4, calls: 2 },
        { name: 'comm', ms: 2, calls: 2 },
      ],
    });
    expect(totals.positions[0]?.pct).toBeCloseTo(200 / 3);
    expect(totals.positions[1]?.pct).toBeCloseTo(100 / 3);
  });

  it('keeps zero-cost trees finite instead of manufacturing a denominator', () => {
    const tree = annotate(leaf('zero', 'single_gemm', '{}', 0));
    const totals = leafTotals(tree);

    expect(tree).toMatchObject({ ms: 0, pct: 0, totalMs: 0 });
    expect(totals).toMatchObject({ totalMs: 0, positions: [{ ms: 0, pct: 0 }] });
    expect(Number.isFinite(totals.positions[0]?.pct)).toBe(true);
  });
});

describe('CostTree malformed boundaries', () => {
  const slot = { name: 'a', kind: 'single_gemm', config: '{}', backend: null };

  it.each([
    [{ kind: 'sum', children: [] }, 'sum requires at least one child'],
    [{ kind: 'max', overlap: 1, children: [] }, 'max requires at least one child'],
    [{ kind: 'scale', n: 2, children: [] }, 'scale requires exactly one child'],
    [
      {
        kind: 'scale',
        n: 2,
        children: [
          { kind: 'leaf', slot, base: 1 },
          { kind: 'leaf', slot: { ...slot, name: 'b' }, base: 1 },
        ],
      },
      'scale requires exactly one child',
    ],
    [{ kind: 'leaf', slot }, 'finite non-negative'],
    [{ kind: 'leaf', slot, base: 1, children: [] }, 'unexpected field children'],
    [{ kind: 'leaf', slot, base: Number.NaN }, 'finite non-negative'],
    [
      {
        kind: 'max',
        overlap: 1.01,
        children: [
          { kind: 'leaf', slot, base: 1 },
          { kind: 'leaf', slot: { ...slot, name: 'b' }, base: 1 },
        ],
      },
      'incompatible overlap',
    ],
    [
      {
        kind: 'scale',
        n: Number.POSITIVE_INFINITY,
        children: [{ kind: 'leaf', slot, base: 1 }],
      },
      'unsigned 32-bit integer',
    ],
    [
      { kind: 'scale', n: 1.5, children: [{ kind: 'leaf', slot, base: 1 }] },
      'unsigned 32-bit integer',
    ],
    [
      { kind: 'scale', n: 0x1_0000_0000, children: [{ kind: 'leaf', slot, base: 1 }] },
      'unsigned 32-bit integer',
    ],
  ])('rejects malformed shape %#', (raw, message) => {
    expect(() => annotate(raw)).toThrow(CostTreeValidationError);
    expect(() => annotate(raw)).toThrow(message);
  });

  it('rejects finite inputs whose derived cost overflows', () => {
    expect(() =>
      annotate(
        sum(
          'overflow',
          leaf('a', 'single_gemm', '{}', Number.MAX_VALUE),
          leaf('b', 'single_gemm', '{}', Number.MAX_VALUE),
        ),
      ),
    ).toThrow(/derived numeric value overflowed/);
  });

  it.each([0, 0.5, 1.01])(
    'rejects unsupported overlap=%s as incompatible at the authoring boundary',
    (overlap) => {
      expect(() =>
        max(
          'unsupported overlap',
          overlap,
          leaf('a', 'single_gemm', '{}', 1),
          leaf('b', 'single_gemm', '{}', 1),
        ),
      ).toThrow(/incompatible overlap: UI CostTree v1 supports only overlap = 1/);
    },
  );

  it('accepts a single-child Max emitted by a one-group fan-out', () => {
    const tree = annotate(max('one group', 1, leaf('a', 'single_gemm', '{}', 3)));

    expect(tree).toMatchObject({ kind: 'max', ms: 3, totalMs: 3 });
  });

  it.each([1.5, 0x1_0000_0000])('rejects non-u32 scale count %s at the authoring boundary', (n) => {
    expect(() => scale('invalid repeat', n, leaf('a', 'single_gemm', '{}', 1))).toThrow(
      /unsigned 32-bit integer/,
    );
  });

  it('rejects cyclic raw nodes before recursive schema parsing', () => {
    const cyclic: { kind: string; children: unknown[] } = { kind: 'sum', children: [] };
    cyclic.children.push(cyclic);

    expect(() => annotate(cyclic)).toThrow(/cyclic node references/);
  });
});
