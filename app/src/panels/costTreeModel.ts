/*
 * CostTree is the UI's validated view of ServingStudioSim's cost-manifest structure.
 * Raw nodes mirror the wire combinators; annotated nodes are immutable copies
 * carrying stable preorder ids, the Analyzer's node times and their share of
 * the root. Keeping the two forms distinct prevents transport-shaped partial
 * objects from leaking into views.
 */
import { parseRawCostNode } from '../artifacts';
import {
  invalidCostTree,
  type CostNode,
  type CostTree,
  type FanoutNode,
  type LeafNode,
  type RawCostNode,
  type KernelComposition,
} from '../artifacts';

export { CostTreeValidationError } from '../artifacts';
export type {
  CostNode,
  CostTree,
  ExactLeafStats,
  FanoutNode,
  JsonValue,
  LeafNode,
  MaxNode,
  NodeKind,
  ParallelNode,
  RawCostNode,
  RawLeafNode,
  RawMaxNode,
  RawParallelNode,
  RawScaleNode,
  RawSlot,
  RawSumNode,
  ScaleNode,
  Slot,
  SumNode,
} from '../artifacts';

function finiteOperation(value: number, path: string): number {
  if (!Number.isFinite(value)) invalidCostTree(path, 'derived numeric value overflowed');
  return value;
}

function multiplyFinite(left: number, right: number, path: string): number {
  return finiteOperation(left * right, path);
}

// ---- immutable annotation ------------------------------------------------
function validateScaleProducts(node: RawCostNode, multiplier: number, path: string): void {
  if (node.kind === 'leaf') return;
  const nextMultiplier =
    node.kind === 'scale' ? multiplyFinite(multiplier, node.n, `${path}.n`) : multiplier;
  node.children.forEach((child, index) =>
    validateScaleProducts(child, nextMultiplier, `${path}.children.${index}`),
  );
}

/** A node's own wall time: a leaf's slot time, or the `ms` the Analyzer
 * folded for a container. */
function nodeMs(node: RawCostNode): number {
  return node.kind === 'leaf' ? node.base : node.ms;
}

function finitePct(ms: number, totalMs: number, path: string): number {
  if (totalMs === 0) return 0;
  return finiteOperation((ms / totalMs) * 100, `${path}.pct`);
}

function annotateNode(
  node: RawCostNode,
  depth: number,
  totalMs: number,
  nextId: { value: number },
  path: string,
): CostNode {
  const id = nextId.value++;
  const ms = nodeMs(node);
  const annotation = { id, depth, ms, pct: finitePct(ms, totalMs, path) };
  switch (node.kind) {
    case 'leaf':
      return Object.freeze({
        kind: 'leaf',
        slot: Object.freeze({
          name: node.slot.name,
          kind: node.slot.kind,
          kernelConfig: node.slot.kernel_config,
          backend: node.slot.backend,
        }),
        base: node.base,
        stats: Object.freeze(node.stats),
        ...annotation,
      });
    case 'sum': {
      const [first, ...rest] = node.children;
      const children: [CostNode, ...CostNode[]] = [
        annotateNode(first, depth + 1, totalMs, nextId, `${path}.children.0`),
        ...rest.map((child, index) =>
          annotateNode(child, depth + 1, totalMs, nextId, `${path}.children.${index + 1}`),
        ),
      ];
      return Object.freeze({
        kind: 'sum',
        ...(node.label === undefined ? {} : { label: node.label }),
        children: Object.freeze(children),
        ...annotation,
      });
    }
    case 'max':
    case 'parallel': {
      const [first, ...rest] = node.children;
      const children: [CostNode, ...CostNode[]] = [
        annotateNode(first, depth + 1, totalMs, nextId, `${path}.children.0`),
        ...rest.map((child, index) =>
          annotateNode(child, depth + 1, totalMs, nextId, `${path}.children.${index + 1}`),
        ),
      ];
      return Object.freeze({
        kind: node.kind,
        ...(node.label === undefined ? {} : { label: node.label }),
        overlap: node.overlap,
        critical: node.critical,
        children: Object.freeze(children),
        ...annotation,
      });
    }
    case 'scale': {
      const children: [CostNode] = [
        annotateNode(node.children[0], depth + 1, totalMs, nextId, `${path}.children.0`),
      ];
      return Object.freeze({
        kind: 'scale',
        ...(node.label === undefined ? {} : { label: node.label }),
        n: node.n,
        children: Object.freeze(children),
        ...annotation,
      });
    }
  }
}

function markRoot(root: CostNode, totalMs: number): CostTree {
  switch (root.kind) {
    case 'leaf':
      return Object.freeze({ ...root, totalMs });
    case 'sum':
      return Object.freeze({ ...root, totalMs });
    case 'max':
      return Object.freeze({ ...root, totalMs });
    case 'parallel':
      return Object.freeze({ ...root, totalMs });
    case 'scale':
      return Object.freeze({ ...root, totalMs });
  }
}

/** Validate an untrusted/raw tree and return a deeply immutable annotated copy. */
export function annotate(input: unknown): CostTree {
  const root = parseRawCostNode(input);
  validateScaleProducts(root, 1, '$');
  const totalMs = nodeMs(root);
  const annotated = annotateNode(root, 0, totalMs, { value: 0 }, '$');
  return markRoot(annotated, totalMs);
}

// ---- formatting and lookup -------------------------------------------------
/** Max (ranks) and Parallel (streams) both cost their slowest child / overlap
 * and both open the critical-path inspector on their `critical` child. */
export function isFanout(node: CostNode): node is FanoutNode {
  return node.kind === 'max' || node.kind === 'parallel';
}

/** Keep generated CostTree identity labels compact without mutating the
 * analyzer-owned label. Worklet type and config remain available in the raw
 * node; cards consistently display only the qualified operation name. */
export const costTreeDisplayLabel = (label: string): string => {
  const generatedMetadataStart = label.indexOf(' (');
  return generatedMetadataStart < 0 ? label : label.slice(0, generatedMetadataStart).trimEnd();
};

export const fmtMs = (ms: number): string => {
  if (!Number.isFinite(ms)) return '—';
  return ms >= 1 ? `${ms.toFixed(2)} ms` : `${(ms * 1000).toFixed(1)} µs`;
};

export const fmtPct = (pct: number): string => {
  if (!Number.isFinite(pct)) return '—';
  return `${pct >= 9.95 ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

function visitChildren(node: CostNode, visit: (child: CostNode) => void): void {
  if (node.kind !== 'leaf') node.children.forEach(visit);
}

export function leafById(root: CostNode, id: number | null): LeafNode | null {
  if (id == null) return null;
  let found: LeafNode | null = null;
  function walk(node: CostNode): void {
    if (found !== null) return;
    if (node.kind === 'leaf' && node.id === id) {
      found = node;
      return;
    }
    visitChildren(node, walk);
  }
  walk(root);
  return found;
}

export function nodeById(root: CostNode, id: number | null): CostNode | null {
  if (id == null) return null;
  let found: CostNode | null = null;
  function walk(node: CostNode): void {
    if (found !== null) return;
    if (node.id === id) {
      found = node;
      return;
    }
    visitChildren(node, walk);
  }
  walk(root);
  return found;
}

/** Ordinal trail from the tree root to the node with `id`, formatted the way
 * the analyzer's scoped-optimality `path` selector expects: child indexes
 * joined by `/`, excluding the root itself. Returns `''` for the root node
 * (callers address the root as the bare section name) and null when the id is
 * absent from the tree. */
export function nodeOrdinalPath(root: CostNode, id: number | null): string | null {
  if (id == null) return null;
  let found: string | null = null;
  function walk(node: CostNode, trail: readonly number[]): void {
    if (found !== null) return;
    if (node.id === id) {
      found = trail.join('/');
      return;
    }
    if (node.kind === 'leaf') return;
    node.children.forEach((child, index) => walk(child, [...trail, index]));
  }
  walk(root, []);
  return found;
}

/** Resolve an Analyzer ordinal path back to the annotated node rendered by the
 * current CostTree. Invalid or stale paths resolve to null, so URL selection
 * cannot accidentally point at a different node after the operation changes. */
export function nodeByOrdinalPath(root: CostNode, path: string | null): CostNode | null {
  if (path === null) return null;
  if (path === '') return root;
  let node: CostNode = root;
  for (const part of path.split('/')) {
    if (!/^\d+$/.test(part) || node.kind === 'leaf') return null;
    const child = node.children[Number(part)];
    if (child === undefined) return null;
    node = child;
  }
  return node;
}

export function leafByName(root: CostNode, name: string): LeafNode | null {
  let found: LeafNode | null = null;
  function walk(node: CostNode): void {
    if (found !== null) return;
    if (node.kind === 'leaf' && node.slot.name === name) {
      found = node;
      return;
    }
    visitChildren(node, walk);
  }
  walk(root);
  return found;
}

/**
 * A leaf's share of the tree root's wall clock: the Analyzer's `time_share`
 * segment for the leaf's position, after Scale and Max/Parallel critical-path
 * attribution. Leaves that share a position name share its segment rather than
 * split it, and a position the composition omits contributed no time.
 */
export function leafSharePct(timeShare: KernelComposition, leaf: LeafNode): number {
  return timeShare.segments.find((segment) => segment.position === leaf.slot.name)?.sharePct ?? 0;
}
