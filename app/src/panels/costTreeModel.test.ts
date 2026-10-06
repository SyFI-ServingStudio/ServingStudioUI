import { describe, expect, it } from 'vitest';

import {
  annotate,
  CostTreeValidationError,
  leafById,
  leafByName,
  leafSharePct,
  isFanout,
  nodeById,
  nodeByOrdinalPath,
  nodeOrdinalPath,
} from './costTreeModel';
import { leaf, max, parallel, scale, sum } from '../test/costTreeDsl';

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

  it('keeps Parallel streams and Max ranks as two fan-out kinds', () => {
    const tree = annotate(
      sum(
        'root',
        parallel(
          'streams',
          0.5,
          leaf('root.shared', 'single_gemm', {}, 1),
          leaf('root.routed', 'grouped_gemm', {}, 3),
        ),
        max(
          'ranks',
          1,
          leaf('root.rank0', 'rms_norm', {}, 2),
          leaf('root.rank1', 'rms_norm', {}, 4),
        ),
      ),
    );
    if (tree.kind !== 'sum') throw new Error('Expected the test root to be Sum.');
    const [streams, ranks] = tree.children;
    expect(streams).toMatchObject({ kind: 'parallel', overlap: 0.5, ms: 6, critical: 1 });
    expect(ranks).toMatchObject({ kind: 'max', overlap: 1, ms: 4, critical: 1 });
    expect(tree.totalMs).toBe(10);
    expect(isFanout(streams)).toBe(true);
    expect(isFanout(ranks)).toBe(true);
    expect(isFanout(tree)).toBe(false);
  });

  it('accepts the Analyzer wire kind "parallel"', () => {
    const tree = annotate({
      kind: 'parallel',
      label: 'moe.local_experts [SGLang dual stream]',
      ms: 2,
      overlap: 1,
      critical: 0,
      children: [
        {
          kind: 'leaf',
          slot: { name: 'shared', kind: 'single_gemm', kernel_config: {}, backend: null },
          base: 2,
          stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
        },
      ],
    });
    expect(tree).toMatchObject({ kind: 'parallel', ms: 2, totalMs: 2 });
    expect(() =>
      annotate({ kind: 'parallel', ms: 0, overlap: 1, critical: 0, children: [] }),
    ).toThrow('parallel requires at least one child');
  });

  it('reads node times and the critical child from the Analyzer, never re-deriving them', () => {
    const stats = { input: null, flops: null, bytes: null, tflops: null, gbps: null };
    const leafNode = (name: string, base: number) => ({
      kind: 'leaf',
      slot: { name, kind: 'single_gemm', kernel_config: {}, backend: null },
      base,
      stats,
    });
    // Deliberately not max(1, 3) / 1: the UI shows what the Analyzer sent.
    const tree = annotate({
      kind: 'sum',
      ms: 8,
      children: [
        {
          kind: 'parallel',
          ms: 5,
          overlap: 1,
          critical: 0,
          children: [leafNode('a', 1), leafNode('b', 3)],
        },
        leafNode('c', 3),
      ],
    });
    expect(tree).toMatchObject({ ms: 8, totalMs: 8 });
    if (tree.kind !== 'sum') throw new Error('Expected a Sum root.');
    expect(tree.children[0]).toMatchObject({ kind: 'parallel', ms: 5, critical: 0 });
    expect(tree.children[0].pct).toBeCloseTo(62.5);
  });

  it('leaves raw authoring data untouched and returns a deeply frozen copy', () => {
    const raw = {
      kind: 'sum',
      label: 'mutable input',
      ms: 1,
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

  it('finds leaves and nodes by preorder id and by name', () => {
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
    expect(tree.totalMs).toBe(6);
  });

  it('round-trips stable Analyzer ordinal paths and rejects stale paths', () => {
    const tree = annotate(
      sum(
        'root',
        leaf('first', 'single_gemm', {}, 1),
        scale('layers', 2, leaf('nested', 'rms_norm', {}, 1)),
      ),
    );
    const nested = nodeByOrdinalPath(tree, '1/0');
    expect(nested?.kind).toBe('leaf');
    expect(nodeOrdinalPath(tree, nested?.id ?? null)).toBe('1/0');
    expect(nodeByOrdinalPath(tree, '')).toBe(tree);
    expect(nodeByOrdinalPath(tree, '1/9')).toBeNull();
    expect(nodeByOrdinalPath(tree, 'one')).toBeNull();
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

    expect(tree).toMatchObject({ ms: 0, pct: 0, totalMs: 0 });
  });
});

describe('CostTree malformed boundaries', () => {
  const slot = { name: 'a', kind: 'single_gemm', kernel_config: {}, backend: null };

  it.each([
    [{ kind: 'sum', ms: 0, children: [] }, 'sum requires at least one child'],
    [
      { kind: 'max', ms: 0, overlap: 1, critical: 0, children: [] },
      'max requires at least one child',
    ],
    [{ kind: 'scale', ms: 0, n: 2, children: [] }, 'scale requires exactly one child'],
    [
      {
        kind: 'scale',
        ms: 2,
        n: 2,
        children: [
          { kind: 'leaf', slot, base: 1 },
          { kind: 'leaf', slot: { ...slot, name: 'b' }, base: 1 },
        ],
      },
      'scale requires exactly one child',
    ],
    [{ kind: 'leaf', slot }, 'finite non-negative'],
    [{ kind: 'leaf', slot, base: Number.NaN }, 'finite non-negative'],
    [
      {
        kind: 'max',
        ms: 1,
        overlap: 0,
        critical: 0,
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
        ms: 1,
        n: Number.POSITIVE_INFINITY,
        children: [{ kind: 'leaf', slot, base: 1 }],
      },
      'unsigned 32-bit integer',
    ],
    [
      { kind: 'scale', ms: 1, n: 1.5, children: [{ kind: 'leaf', slot, base: 1 }] },
      'unsigned 32-bit integer',
    ],
    [
      { kind: 'scale', ms: 1, n: 0x1_0000_0000, children: [{ kind: 'leaf', slot, base: 1 }] },
      'unsigned 32-bit integer',
    ],
  ])('rejects malformed shape %#', (raw, message) => {
    expect(() => annotate(raw)).toThrow(CostTreeValidationError);
    expect(() => annotate(raw)).toThrow(message);
  });

  it('rejects a container without a finite Analyzer time or with a stray critical child', () => {
    const child = {
      kind: 'leaf',
      slot,
      base: 1,
      stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
    };
    expect(() => annotate({ kind: 'sum', children: [child] })).toThrow('finite non-negative');
    expect(() =>
      annotate({ kind: 'sum', ms: Number.POSITIVE_INFINITY, children: [child] }),
    ).toThrow('finite non-negative');
    expect(() =>
      annotate({ kind: 'parallel', ms: 1, overlap: 1, critical: 1, children: [child] }),
    ).toThrow('critical child 1 is out of range');
  });

  it('accepts a single-child Max emitted by a one-group fan-out', () => {
    const tree = annotate(max('one group', 1, leaf('a', 'single_gemm', {}, 3)));

    expect(tree).toMatchObject({ kind: 'max', ms: 3, totalMs: 3 });
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

describe('leafSharePct', () => {
  const timeShare = {
    kernelTimeMs: 4,
    segments: [{ position: 'root.a', kind: 'single_gemm', kernelTimeMs: 3, sharePct: 75 }],
  };

  it('reads the Analyzer segment for the leaf position, not the leaf’s own fraction', () => {
    const tree = annotate(
      sum('root', leaf('root.a', 'single_gemm', {}, 1), leaf('root.b', 'rms_norm', {}, 3)),
    );
    expect(leafSharePct(timeShare, leafByName(tree, 'root.a')!)).toBe(75);
  });

  it('is zero for a position the composition omits', () => {
    const tree = annotate(
      sum('root', leaf('root.a', 'single_gemm', {}, 1), leaf('root.b', 'rms_norm', {}, 3)),
    );
    expect(leafSharePct(timeShare, leafByName(tree, 'root.b')!)).toBe(0);
  });
});
