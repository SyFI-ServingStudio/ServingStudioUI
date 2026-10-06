/*
 * Authoring DSL for raw CostTree fixtures. The Analyzer sends each container's
 * wall time (`ms`) and each Max/Parallel's critical child; these builders stand
 * in for it, so they fold the times the same way: Sum adds, Max and Parallel
 * take the slowest child over `overlap` (the last one on a tie, as the
 * Analyzer's `critical_child` does), Scale repeats its child n times. App code
 * reads those fields and never folds them.
 */
import {
  invalidCostTree,
  type ExactLeafStats,
  type JsonValue,
  type RawCostNode,
  type RawLeafNode,
  type RawMaxNode,
  type RawParallelNode,
  type RawScaleNode,
  type RawSlot,
  type RawSumNode,
} from '../artifacts';

function requireFiniteNonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalidCostTree(path, 'expected a finite non-negative number');
  }
  return value;
}

function requireFinitePositive(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    invalidCostTree(path, 'expected a finite positive number');
  }
  return value;
}

function requireString(value: unknown, path: string, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    invalidCostTree(path, allowEmpty ? 'expected a string' : 'expected a non-empty string');
  }
  return value;
}

function requireUint32(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    invalidCostTree(path, 'expected an unsigned 32-bit integer');
  }
  return value;
}

const nodeMs = (node: RawCostNode): number => (node.kind === 'leaf' ? node.base : node.ms);

/** The slowest child's index, the last one on a tie. */
function criticalIndex(children: readonly RawCostNode[]): number {
  return children.reduce(
    (best, child, index) => (nodeMs(child) >= nodeMs(children[best]!) ? index : best),
    0,
  );
}

export function leaf(
  name: string,
  kind: string,
  kernelConfig: Readonly<Record<string, JsonValue>>,
  base: number,
  backend?: string,
  stats: ExactLeafStats = {
    input: null,
    flops: null,
    bytes: null,
    tflops: null,
    gbps: null,
  },
): RawLeafNode {
  return Object.freeze({
    kind: 'leaf',
    slot: Object.freeze({
      name: requireString(name, 'leaf.slot.name', false),
      kind: requireString(kind, 'leaf.slot.kind', false),
      kernel_config: Object.freeze(kernelConfig),
      backend: backend ?? null,
    }) as RawSlot,
    base: requireFiniteNonNegative(base, 'leaf.base'),
    stats,
  });
}

export function sum(
  label: string | undefined,
  first: RawCostNode,
  ...rest: RawCostNode[]
): RawSumNode {
  const children: [RawCostNode, ...RawCostNode[]] = [first, ...rest];
  return Object.freeze({
    kind: 'sum',
    ...(label === undefined ? {} : { label }),
    ms: children.reduce((total, child) => total + nodeMs(child), 0),
    children: Object.freeze(children),
  });
}

function fanout<K extends 'max' | 'parallel'>(
  kind: K,
  label: string | undefined,
  overlap: number,
  children: [RawCostNode, ...RawCostNode[]],
) {
  const critical = criticalIndex(children);
  return Object.freeze({
    kind,
    ...(label === undefined ? {} : { label }),
    ms: nodeMs(children[critical]!) / requireFinitePositive(overlap, `${kind}.overlap`),
    overlap,
    critical,
    children: Object.freeze(children),
  });
}

export function max(
  label: string | undefined,
  overlap: number,
  first: RawCostNode,
  ...rest: RawCostNode[]
): RawMaxNode {
  return fanout('max', label, overlap, [first, ...rest]);
}

export function parallel(
  label: string | undefined,
  overlap: number,
  first: RawCostNode,
  ...rest: RawCostNode[]
): RawParallelNode {
  return fanout('parallel', label, overlap, [first, ...rest]);
}

export function scale(label: string | undefined, n: number, child: RawCostNode): RawScaleNode {
  const children: [RawCostNode] = [child];
  return Object.freeze({
    kind: 'scale',
    ...(label === undefined ? {} : { label }),
    ms: requireUint32(n, 'scale.n') * nodeMs(child),
    n,
    children: Object.freeze(children),
  });
}
