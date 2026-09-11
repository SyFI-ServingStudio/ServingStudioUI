import { describe, expect, it } from 'vitest';

import type { OptimalityKernelLadderData } from '../../artifacts';
import type { CostNode, LeafNode, ScaleNode, SumNode } from '../costTreeModel';
import {
  componentByLeafName,
  filterLadderKernels,
  groupLadderByComponent,
  normalizeLadderPerCall,
  perCallDivisors,
  scopedLeafNames,
} from './ladderScope';

function leaf(id: number, name: string): LeafNode {
  return {
    kind: 'leaf',
    id,
    depth: 2,
    ms: 1,
    pct: 10,
    base: 1,
    slot: { name, kind: 'rms_norm', kernelConfig: {}, backend: null },
    stats: { input: null, flops: null, bytes: null, tflops: null, gbps: null },
  };
}

function sum(id: number, label: string | undefined, children: CostNode[]): SumNode {
  return {
    kind: 'sum',
    id,
    depth: 1,
    ms: 2,
    pct: 20,
    ...(label === undefined ? {} : { label }),
    children: children as unknown as SumNode['children'],
  };
}

function scaleNode(id: number, n: number, child: CostNode): ScaleNode {
  return {
    kind: 'scale',
    id,
    depth: 1,
    ms: 2,
    pct: 20,
    n,
    children: [child] as const,
  };
}

const TREE = sum(0, undefined, [
  sum(1, 'unified.qk_norm (QkNormLocalWorklet) [local]', [
    leaf(2, 'unified.qk_norm.q_norm'),
    leaf(3, 'unified.qk_norm.k_norm'),
  ]),
  leaf(4, 'unified.embedding'),
]);

function ladder(): OptimalityKernelLadderData {
  const kernel = (name: string, hardwareLimit: number, necessaryLimit: number | null) => ({
    name,
    kind: 'rms_norm',
    isComm: false,
    rungs: {
      balanced: hardwareLimit * 2,
      perConfigBest: hardwareLimit * 1.5,
      ignoreNetwork: hardwareLimit * 1.2,
      hardwareLimit,
      necessaryLimit,
    },
    necessaryWork: null,
  });
  return {
    label: 'iter 0',
    rungs: {
      real: 10,
      busy: 9,
      balanced: 8,
      perConfigBest: 6,
      ignoreNetwork: 5,
      hardwareLimit: 4,
      segmentedNecessary: 1,
      scopeFusedNecessary: 0.9,
    },
    specialChunks: { idle: 1, imbalance: 0.5 },
    kernels: [
      kernel('unified.qk_norm.q_norm', 1, 0.1),
      kernel('unified.qk_norm.k_norm', 2, null),
      kernel('unified.embedding', 4, 0.4),
    ],
  };
}

describe('scopedLeafNames', () => {
  it('collects leaf slot names under the selected container', () => {
    expect(scopedLeafNames(TREE, 1)).toEqual(
      new Set(['unified.qk_norm.q_norm', 'unified.qk_norm.k_norm']),
    );
  });

  it('returns null for an absent id', () => {
    expect(scopedLeafNames(TREE, 99)).toBeNull();
  });
});

describe('filterLadderKernels', () => {
  it('keeps only scoped kernels and removes scope-wide quantities', () => {
    const names = scopedLeafNames(TREE, 1)!;
    const filtered = filterLadderKernels(ladder(), names);
    expect(filtered.kernels.map((kernel) => kernel.name)).toEqual([
      'unified.qk_norm.q_norm',
      'unified.qk_norm.k_norm',
    ]);
    expect(filtered.specialChunks).toEqual({ idle: 0, imbalance: 0 });
    expect(filtered.rungs.scopeFusedNecessary).toBeNull();
    expect(filtered.rungs.segmentedNecessary).toBe(1);
  });
});

describe('componentByLeafName', () => {
  it('maps each leaf to its nearest labeled ancestor caption', () => {
    const components = componentByLeafName(TREE);
    expect(components.get('unified.qk_norm.q_norm')).toBe('unified.qk_norm');
    expect(components.get('unified.qk_norm.k_norm')).toBe('unified.qk_norm');
    // No labeled ancestor: the leaf stays its own component.
    expect(components.get('unified.embedding')).toBe('unified.embedding');
  });
});

const SCALED_TREE = sum(0, undefined, [
  scaleNode(
    5,
    28,
    sum(1, 'unified.qk_norm (QkNormLocalWorklet) [local]', [
      leaf(2, 'unified.qk_norm.q_norm'),
      leaf(3, 'unified.qk_norm.k_norm'),
    ]),
  ),
  leaf(4, 'unified.embedding'),
]);

describe('perCallDivisors', () => {
  it('divides leaves by their scale-folded call counts at kernel granularity', () => {
    const divisors = perCallDivisors(SCALED_TREE, 'kernel');
    expect(divisors.get('unified.qk_norm.q_norm')).toBe(28);
    expect(divisors.get('unified.qk_norm.k_norm')).toBe(28);
    expect(divisors.get('unified.embedding')).toBe(1);
  });

  it('divides components by their instance count, not their kernel-call count', () => {
    const divisors = perCallDivisors(SCALED_TREE, 'component');
    expect(divisors.get('unified.qk_norm')).toBe(28);
    // Self-named component keeps its own leaf call count.
    expect(divisors.get('unified.embedding')).toBe(1);
  });
});

describe('normalizeLadderPerCall', () => {
  it('rescales rungs per row and removes scope-wide quantities', () => {
    const divisors = perCallDivisors(SCALED_TREE, 'kernel');
    const normalized = normalizeLadderPerCall(ladder(), divisors);
    const qNorm = normalized.kernels.find((kernel) => kernel.name === 'unified.qk_norm.q_norm')!;
    expect(qNorm.rungs.hardwareLimit).toBeCloseTo(1 / 28, 12);
    expect(qNorm.rungs.balanced).toBeCloseTo(2 / 28, 12);
    expect(qNorm.rungs.necessaryLimit).toBeCloseTo(0.1 / 28, 12);
    expect(qNorm.necessaryWork).toBeNull();
    const embedding = normalized.kernels.find((kernel) => kernel.name === 'unified.embedding')!;
    expect(embedding.rungs.hardwareLimit).toBe(4);
    // Null necessary attribution stays null instead of becoming 0/divisor.
    const kNorm = normalized.kernels.find((kernel) => kernel.name === 'unified.qk_norm.k_norm')!;
    expect(kNorm.rungs.necessaryLimit).toBeUndefined();
    expect(normalized.specialChunks).toEqual({ idle: 0, imbalance: 0 });
    expect(normalized.rungs.scopeFusedNecessary).toBeNull();
  });
});

describe('groupLadderByComponent', () => {
  it('sums additive rungs per component and keeps ungrouped leaves intact', () => {
    const grouped = groupLadderByComponent(ladder(), componentByLeafName(TREE));
    expect(grouped.kernels.map((kernel) => kernel.name)).toEqual([
      'unified.qk_norm',
      'unified.embedding',
    ]);
    const qkNorm = grouped.kernels[0];
    expect(qkNorm.rungs.hardwareLimit).toBe(3);
    expect(qkNorm.rungs.balanced).toBe(6);
    // Partial necessary coverage sums what exists rather than inventing zeros
    // for the uncovered kernel.
    expect(qkNorm.rungs.necessaryLimit).toBe(0.1);
    // Dominant-by-hardware-limit member names the component kind.
    expect(qkNorm.kind).toBe('rms_norm');
    expect(qkNorm.necessaryWork).toBeNull();
  });
});
