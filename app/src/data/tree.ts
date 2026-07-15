/*
 * CostTree is the UI's validated view of VibeSim's cost-manifest structure.
 * Raw nodes mirror the wire combinators; annotated nodes are immutable copies
 * carrying stable preorder ids and finite derived costs. Keeping the two forms
 * distinct prevents transport-shaped partial objects from leaking into views.
 */
import { parseRawCostNode } from './treeSchema';
import {
  invalidCostTree,
  type CostNode,
  type CostTree,
  type LeafNode,
  type RawCostNode,
  type RawLeafNode,
  type RawMaxNode,
  type RawScaleNode,
  type RawSumNode,
} from './treeTypes';

export { CostTreeValidationError } from './treeTypes';
export type {
  CostNode,
  CostTree,
  LeafNode,
  MaxNode,
  NodeKind,
  RawCostNode,
  RawLeafNode,
  RawMaxNode,
  RawScaleNode,
  RawSumNode,
  ScaleNode,
  Slot,
  SumNode,
} from './treeTypes';

function requireFiniteNonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    invalidCostTree(path, 'expected a finite non-negative number');
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

function finiteOperation(value: number, path: string): number {
  if (!Number.isFinite(value)) invalidCostTree(path, 'derived numeric value overflowed');
  return value;
}

function addFinite(left: number, right: number, path: string): number {
  return finiteOperation(left + right, path);
}

function multiplyFinite(left: number, right: number, path: string): number {
  return finiteOperation(left * right, path);
}

// ---- authoring DSL (used by validated fixture adapters) --------------------
export function leaf(
  name: string,
  kind: string,
  config: string,
  base: number,
  backend?: string,
): RawLeafNode {
  return Object.freeze({
    kind: 'leaf',
    slot: Object.freeze({
      name: requireString(name, 'leaf.slot.name', false),
      kind: requireString(kind, 'leaf.slot.kind', false),
      config: requireString(config, 'leaf.slot.config'),
      backend: backend ?? null,
    }),
    base: requireFiniteNonNegative(base, 'leaf.base'),
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
    children: Object.freeze(children),
  });
}

export function max(
  label: string | undefined,
  overlap: number,
  first: RawCostNode,
  ...rest: RawCostNode[]
): RawMaxNode {
  if (!Number.isFinite(overlap)) {
    invalidCostTree('max.overlap', 'expected a finite overlap number');
  }
  if (overlap !== 1) {
    invalidCostTree(
      'max.overlap',
      'incompatible overlap: UI CostTree v1 supports only overlap = 1',
    );
  }
  const children: [RawCostNode, ...RawCostNode[]] = [first, ...rest];
  return Object.freeze({
    kind: 'max',
    ...(label === undefined ? {} : { label }),
    overlap: 1,
    children: Object.freeze(children),
  });
}

export function scale(label: string | undefined, n: number, child: RawCostNode): RawScaleNode {
  const children: [RawCostNode] = [child];
  return Object.freeze({
    kind: 'scale',
    ...(label === undefined ? {} : { label }),
    n: requireUint32(n, 'scale.n'),
    children: Object.freeze(children),
  });
}

// ---- kernel-kind taxonomy --------------------------------------------------
export const KIND: Readonly<Record<string, { readonly group: string; readonly label: string }>> = {
  single_gemm: { group: 'gemm', label: 'GEMM' },
  grouped_gemm: { group: 'gemm', label: 'Grouped GEMM' },
  flashinfer_attn_prefill: { group: 'attn', label: 'Attn · prefill' },
  flashinfer_attn_decode: { group: 'attn', label: 'Attn · decode' },
  kv_cache_append: { group: 'attn', label: 'KV append' },
  rms_norm: { group: 'norm', label: 'RMSNorm' },
  elementwise: { group: 'norm', label: 'Elementwise' },
  all_reduce: { group: 'comm', label: 'AllReduce' },
  p2p_intra: { group: 'comm', label: 'P2P · intra-NVL' },
  p2p_inter: { group: 'comm', label: 'P2P · inter-NVL' },
  moe_router: { group: 'route', label: 'MoE router' },
};

export const GROUP: Readonly<Record<string, { readonly label: string; readonly color: string }>> = {
  // These colors serve as both rails on light cards and filled time-share
  // blocks carrying white labels, so each must clear AA in both contexts.
  gemm: { label: 'Dense GEMM', color: '#8a5700' },
  attn: { label: 'Attention', color: '#176a6d' },
  comm: { label: 'Collectives', color: '#922554' },
  norm: { label: 'Norm / EW', color: '#4b651f' },
  route: { label: 'Routing', color: '#5940c4' },
  misc: { label: 'Other', color: '#526173' },
};

export const groupOf = (kind: string): string => KIND[kind]?.group ?? 'misc';
export const colorOf = (kind: string): string => GROUP[groupOf(kind)].color;
export const kindLabel = (kind: string): string => KIND[kind]?.label ?? kind;

// ---- cost validation and immutable annotation -----------------------------
function computeCosts(node: RawCostNode, path: string, costs: WeakMap<object, number>): number {
  let nodeCost: number;
  switch (node.kind) {
    case 'leaf':
      nodeCost = node.base;
      break;
    case 'sum':
      nodeCost = node.children.reduce(
        (total, child, index) =>
          addFinite(total, computeCosts(child, `${path}.children.${index}`, costs), path),
        0,
      );
      break;
    case 'max': {
      const childCosts = node.children.map((child, index) =>
        computeCosts(child, `${path}.children.${index}`, costs),
      );
      const [firstCost, ...restCosts] = childCosts;
      if (firstCost === undefined) invalidCostTree(path, 'validated Max has no child cost');
      const maximum = restCosts.reduce(
        (currentMaximum, childCost) => Math.max(currentMaximum, childCost),
        firstCost,
      );
      // Protocol v1 accepts only overlap=1, so Max is the pure critical-path
      // maximum. Future overlap algebra needs its own versioned decoder.
      nodeCost = maximum;
      break;
    }
    case 'scale':
      nodeCost = multiplyFinite(
        node.n,
        computeCosts(node.children[0], `${path}.children.0`, costs),
        path,
      );
      break;
  }
  costs.set(node, nodeCost);
  return nodeCost;
}

function validateScaleProducts(node: RawCostNode, multiplier: number, path: string): void {
  if (node.kind === 'leaf') return;
  const nextMultiplier =
    node.kind === 'scale' ? multiplyFinite(multiplier, node.n, `${path}.n`) : multiplier;
  node.children.forEach((child, index) =>
    validateScaleProducts(child, nextMultiplier, `${path}.children.${index}`),
  );
}

function annotatedCost(node: RawCostNode, costs: WeakMap<object, number>): number {
  const value = costs.get(node);
  if (value === undefined) invalidCostTree('$', 'internal cost annotation is missing');
  return value;
}

function finitePct(ms: number, totalMs: number, path: string): number {
  if (totalMs === 0) return 0;
  return finiteOperation((ms / totalMs) * 100, `${path}.pct`);
}

function annotateNode(
  node: RawCostNode,
  depth: number,
  totalMs: number,
  costs: WeakMap<object, number>,
  nextId: { value: number },
  path: string,
): CostNode {
  const id = nextId.value++;
  const ms = annotatedCost(node, costs);
  const annotation = { id, depth, ms, pct: finitePct(ms, totalMs, path) };
  switch (node.kind) {
    case 'leaf':
      return Object.freeze({ ...node, ...annotation });
    case 'sum': {
      const [first, ...rest] = node.children;
      const children: [CostNode, ...CostNode[]] = [
        annotateNode(first, depth + 1, totalMs, costs, nextId, `${path}.children.0`),
        ...rest.map((child, index) =>
          annotateNode(child, depth + 1, totalMs, costs, nextId, `${path}.children.${index + 1}`),
        ),
      ];
      return Object.freeze({
        kind: 'sum',
        ...(node.label === undefined ? {} : { label: node.label }),
        children: Object.freeze(children),
        ...annotation,
      });
    }
    case 'max': {
      const [first, ...rest] = node.children;
      const children: [CostNode, ...CostNode[]] = [
        annotateNode(first, depth + 1, totalMs, costs, nextId, `${path}.children.0`),
        ...rest.map((child, index) =>
          annotateNode(child, depth + 1, totalMs, costs, nextId, `${path}.children.${index + 1}`),
        ),
      ];
      return Object.freeze({
        kind: 'max',
        ...(node.label === undefined ? {} : { label: node.label }),
        overlap: node.overlap,
        children: Object.freeze(children),
        ...annotation,
      });
    }
    case 'scale': {
      const children: [CostNode] = [
        annotateNode(node.children[0], depth + 1, totalMs, costs, nextId, `${path}.children.0`),
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
    case 'scale':
      return Object.freeze({ ...root, totalMs });
  }
}

/** Validate an untrusted/raw tree and return a deeply immutable annotated copy. */
export function annotate(input: unknown): CostTree {
  const root = parseRawCostNode(input);
  validateScaleProducts(root, 1, '$');
  const costs = new WeakMap<object, number>();
  const totalMs = computeCosts(root, '$', costs);
  const annotated = annotateNode(root, 0, totalMs, costs, { value: 0 }, '$');
  return markRoot(annotated, totalMs);
}

// ---- derived breakdowns (drive the time-share view) ------------------------
export interface LeafPosition {
  readonly name: string;
  readonly kind: string;
  readonly group: string;
  readonly ms: number;
  readonly calls: number;
  readonly pct: number;
}

export interface LeafGroup {
  readonly group: string;
  readonly label: string;
  readonly color: string;
  readonly ms: number;
  readonly pct: number;
}

export interface LeafTotals {
  readonly positions: readonly LeafPosition[];
  readonly groups: readonly LeafGroup[];
  readonly totalMs: number;
}

export function leafTotals(root: CostNode): LeafTotals {
  const byName = new Map<string, LeafPosition>();
  const byGroup = new Map<string, number>();
  function walk(node: CostNode, multiplier: number): void {
    if (node.kind === 'leaf') {
      const ms = multiplyFinite(multiplier, node.base, `leafTotals.${node.slot.name}.ms`);
      const group = groupOf(node.slot.kind);
      const current = byName.get(node.slot.name) ?? {
        name: node.slot.name,
        kind: node.slot.kind,
        group,
        ms: 0,
        calls: 0,
        pct: 0,
      };
      byName.set(node.slot.name, {
        ...current,
        ms: addFinite(current.ms, ms, `leafTotals.${node.slot.name}.ms`),
        calls: addFinite(current.calls, multiplier, `leafTotals.${node.slot.name}.calls`),
      });
      byGroup.set(group, addFinite(byGroup.get(group) ?? 0, ms, `leafTotals.${group}.ms`));
      return;
    }
    const nextMultiplier =
      node.kind === 'scale'
        ? multiplyFinite(multiplier, node.n, `leafTotals.scale.${node.id}`)
        : multiplier;
    node.children.forEach((child) => walk(child, nextMultiplier));
  }
  walk(root, 1);

  const totalMs = [...byGroup.values()].reduce(
    (total, ms) => addFinite(total, ms, 'leafTotals.totalMs'),
    0,
  );
  const pct = (ms: number, path: string) => finitePct(ms, totalMs, path);
  const positions = [...byName.values()]
    .map((position) => ({
      ...position,
      pct: pct(position.ms, `leafTotals.${position.name}.pct`),
    }))
    .sort((left, right) => right.ms - left.ms);
  const groups = [...byGroup.entries()]
    .map(([group, ms]) => ({
      group,
      label: GROUP[group].label,
      color: GROUP[group].color,
      ms,
      pct: pct(ms, `leafTotals.${group}.pct`),
    }))
    .sort((left, right) => right.ms - left.ms);
  return { positions, groups, totalMs };
}

// ---- formatting and lookup -------------------------------------------------
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
