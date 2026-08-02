import { describe, expect, it } from 'vitest';

import {
  annotate,
  criticalLeafContributions,
  criticalLeafTotals,
  leaf,
  leafById,
  leafByName,
  leafTotals,
  max,
  nodeById,
  scale,
  sum,
  CostTreeValidationError,
} from './index';

describe('CostTree annotation', () => {
  it('annotates all four node kinds with finite preorder metadata and costs', () => {
    const tree = annotate(
      sum(
        'root',
        leaf('root.a', 'single_gemm', {}, 2),
        max(
          'parallel',
          1,
          leaf('root.b', 'all_reduce', {}, 3),
          scale('layers', 2, leaf('root.c', 'rms_norm', {}, 1)),
        ),
      ),
    );

    expect(tree).toMatchObject({ kind: 'sum', id: 0, depth: 0, ms: 5, pct: 100, totalMs: 5 });
    if (tree.kind !== 'sum') throw new Error('Expected the test root to be Sum.');
    const [leafA, parallel] = tree.children;
    expect(leafA).toMatchObject({ kind: 'leaf', id: 1, depth: 1, ms: 2 });
    expect(leafA.pct).toBeCloseTo(40);
    expect(parallel).toMatchObject({ kind: 'max', id: 2, depth: 1, ms: 3 });
    expect(parallel).toHaveProperty('overlap', 1);
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
          slot: {
            name: 'a',
            kind: 'single_gemm',
            kernel_config: {
              n: {
                value: 7168,
                expression: 'hidden/tp',
                bindings: { hidden: 28672, tp: 4 },
              },
            },
            backend: null,
          },
          base: 1,
          stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
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
    expect(child.slot.kernelConfig).toMatchObject({
      n: { value: 7168, expression: 'hidden/tp' },
    });
    expect(Object.isFrozen(child.slot.kernelConfig)).toBe(true);
    expect(Object.isFrozen(child.slot.kernelConfig.n)).toBe(true);
  });

  it('returns precise leaf types and stable derived busy-time totals', () => {
    const tree = annotate(
      scale(
        'twice',
        2,
        sum('body', leaf('gemm', 'single_gemm', {}, 2), leaf('comm', 'all_reduce', {}, 1)),
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

  it('attributes Sum, Scale, Max, and overlap to root critical-path time', () => {
    const tree = annotate(
      sum(
        'root',
        leaf('a', 'single_gemm', {}, 4),
        scale(
          'twice',
          2,
          max('parallel', 2, leaf('b', 'all_reduce', {}, 6), leaf('c', 'rms_norm', {}, 10)),
        ),
      ),
    );

    const contributions = criticalLeafContributions(tree);
    const totals = criticalLeafTotals(tree);

    expect(tree.totalMs).toBe(14);
    expect(totals).toMatchObject({
      totalMs: 14,
      positions: [
        { name: 'c', ms: 10 },
        { name: 'a', ms: 4 },
      ],
    });
    expect(totals.positions.find((position) => position.name === 'b')).toBeUndefined();
    expect(totals.positions[0]?.pct).toBeCloseTo((10 / 14) * 100);
    expect(totals.positions[1]?.pct).toBeCloseTo((4 / 14) * 100);
    expect(totals.positions.reduce((total, position) => total + position.pct, 0)).toBeCloseTo(100);
    expect(contributions).toMatchObject([
      { id: 5, name: 'c', ms: 10 },
      { id: 1, name: 'a', ms: 4 },
    ]);
    expect(contributions[0]?.pct).toBeCloseTo((10 / 14) * 100);
    expect(contributions.find((contribution) => contribution.name === 'b')).toBeUndefined();
  });

  it('splits exact Max ties without losing Scale attribution', () => {
    const tree = annotate(
      scale(
        'twice',
        2,
        max('tie', 1, leaf('left', 'single_gemm', {}, 5), leaf('right', 'all_reduce', {}, 5)),
      ),
    );

    const contributions = criticalLeafContributions(tree);
    const totals = criticalLeafTotals(tree);

    expect(totals).toMatchObject({
      totalMs: 10,
      positions: [
        { ms: 5, pct: 50 },
        { ms: 5, pct: 50 },
      ],
    });
    expect(contributions).toMatchObject([
      { name: 'left', ms: 5, pct: 50 },
      { name: 'right', ms: 5, pct: 50 },
    ]);
  });

  it('keeps exact duplicate leaf identities while position totals aggregate their name', () => {
    const tree = annotate(
      sum(
        'root',
        leaf('shared', 'single_gemm', {}, 2),
        scale('twice', 2, leaf('shared', 'single_gemm', {}, 3)),
      ),
    );

    const contributions = criticalLeafContributions(tree);
    const totals = criticalLeafTotals(tree);

    expect(contributions).toMatchObject([
      { id: 3, name: 'shared', ms: 6, pct: 75 },
      { id: 1, name: 'shared', ms: 2, pct: 25 },
    ]);
    expect(totals.positions).toMatchObject([{ name: 'shared', ms: 8, pct: 100 }]);
  });

  it('keeps preorder selection ids stable across value-only reannotation', () => {
    const build = (leftMs: number, rightMs: number) =>
      annotate(
        sum(
          'root',
          leaf('left', 'single_gemm', {}, leftMs),
          leaf('right', 'all_reduce', {}, rightMs),
        ),
      );
    const first = build(1, 2);
    const reweighted = build(4, 1);

    expect(leafByName(first, 'left')?.id).toBe(leafByName(reweighted, 'left')?.id);
    expect(leafByName(first, 'right')?.id).toBe(leafByName(reweighted, 'right')?.id);
    expect(first.totalMs).not.toBe(reweighted.totalMs);
  });

  it('keeps zero-cost trees finite instead of manufacturing a denominator', () => {
    const tree = annotate(leaf('zero', 'single_gemm', {}, 0));
    const totals = leafTotals(tree);

    expect(tree).toMatchObject({ ms: 0, pct: 0, totalMs: 0 });
    expect(totals).toMatchObject({ totalMs: 0, positions: [{ ms: 0, pct: 0 }] });
    expect(Number.isFinite(totals.positions[0]?.pct)).toBe(true);
  });
});

describe('CostTree malformed boundaries', () => {
  const slot = { name: 'a', kind: 'single_gemm', kernel_config: {}, backend: null };

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
    [
      {
        kind: 'leaf',
        slot,
        base: 1,
        stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
        children: [],
      },
      'unexpected field children',
    ],
    [{ kind: 'leaf', slot, base: Number.NaN }, 'finite non-negative'],
    [
      {
        kind: 'max',
        overlap: 0,
        children: [
          { kind: 'leaf', slot, base: 1 },
          { kind: 'leaf', slot: { ...slot, name: 'b' }, base: 1 },
        ],
      },
      'finite positive overlap',
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

  it('rejects the retired string config field instead of guessing its structure', () => {
    expect(() =>
      annotate({
        kind: 'leaf',
        slot: { name: 'a', kind: 'single_gemm', config: 'm=1,n=2,k=3', backend: null },
        base: 1,
        stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
      }),
    ).toThrow('kernel_config');
  });

  it('rejects finite inputs whose derived cost overflows', () => {
    expect(() =>
      annotate(
        sum(
          'overflow',
          leaf('a', 'single_gemm', {}, Number.MAX_VALUE),
          leaf('b', 'single_gemm', {}, Number.MAX_VALUE),
        ),
      ),
    ).toThrow(/derived numeric value overflowed/);
  });

  it('accepts a single-child Max emitted by a one-group fan-out', () => {
    const tree = annotate(max('one group', 1, leaf('a', 'single_gemm', {}, 3)));

    expect(tree).toMatchObject({ kind: 'max', ms: 3, totalMs: 3 });
  });

  it('applies a finite positive Max overlap divisor like the Rust manifest fold', () => {
    const tree = annotate(
      max('overlapped', 2, leaf('slow', 'single_gemm', {}, 8), leaf('fast', 'single_gemm', {}, 3)),
    );

    expect(tree).toMatchObject({ kind: 'max', overlap: 2, ms: 4, totalMs: 4 });
  });

  it.each([1.5, 0x1_0000_0000])('rejects non-u32 scale count %s at the authoring boundary', (n) => {
    expect(() => scale('invalid repeat', n, leaf('a', 'single_gemm', {}, 1))).toThrow(
      /unsigned 32-bit integer/,
    );
  });

  it('rejects cyclic raw nodes before recursive schema parsing', () => {
    const cyclic: { kind: string; children: unknown[] } = { kind: 'sum', children: [] };
    cyclic.children.push(cyclic);

    expect(() => annotate(cyclic)).toThrow(/cyclic node references/);
  });
});
