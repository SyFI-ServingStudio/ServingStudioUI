/*
 * CostTree is the UI's validated view of VibeSim's cost-manifest structure.
 * Raw nodes mirror the wire combinators; annotated nodes are immutable copies
 * carrying stable preorder ids and finite derived costs. Keeping the two forms
 * distinct prevents transport-shaped partial objects from leaking into views.
 */
import { parseRawCostNode } from '../artifacts';
import {
  invalidCostTree,
  type CostNode,
  type CostTree,
  type LeafNode,
  type RawCostNode,
  type RawLeafNode,
  type RawMaxNode,
  type RawScaleNode,
  type RawSlot,
  type RawSumNode,
  type ExactLeafStats,
  type JsonValue,
} from '../artifacts';

export { CostTreeValidationError } from '../artifacts';
export type {
  CostNode,
  CostTree,
  ExactLeafStats,
  JsonValue,
  LeafNode,
  MaxNode,
  NodeKind,
  RawCostNode,
  RawLeafNode,
  RawMaxNode,
  RawScaleNode,
  RawSlot,
  RawSumNode,
  ScaleNode,
  Slot,
  SumNode,
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
    children: Object.freeze(children),
  });
}

export function max(
  label: string | undefined,
  overlap: number,
  first: RawCostNode,
  ...rest: RawCostNode[]
): RawMaxNode {
  const children: [RawCostNode, ...RawCostNode[]] = [first, ...rest];
  return Object.freeze({
    kind: 'max',
    ...(label === undefined ? {} : { label }),
    overlap: requireFinitePositive(overlap, 'max.overlap'),
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
// Re-exported, not restated: the table is shared with the rebuilt kernel-time
// panels, and two copies of a colour-and-label map drift without failing.
import { GROUP, groupOf } from './kernelTaxonomy';

export { KIND, GROUP, GROUP_ORDER, groupOf, colorOf, kindLabel } from './kernelTaxonomy';

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
      nodeCost = finiteOperation(maximum / node.overlap, path);
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

export interface CriticalLeafContribution {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly group: string;
  readonly ms: number;
  readonly calls: number;
  readonly pct: number;
}

/** Attribute one exact CostTree root to its critical-path leaf identities.
 *
 * This mirrors analyzer `kernel-time-share`: Sum forwards to every child,
 * Scale multiplies its child, and Max forwards only to the largest child after
 * dividing by overlap. Exactly tied Max children split attribution evenly.
 * Consequently the returned leaf times sum to the modeled root wall-clock
 * cost, rather than to the work performed by all parallel branches. */
export function criticalLeafContributions(root: CostTree): readonly CriticalLeafContribution[] {
  const contributions: Omit<CriticalLeafContribution, 'pct'>[] = [];
  const tieRelativeEpsilon = 1e-9;

  function walk(node: CostNode, attributionScale: number): void {
    if (node.kind === 'leaf') {
      const ms = multiplyFinite(
        attributionScale,
        node.base,
        `criticalLeafContributions.${node.id}.ms`,
      );
      const group = groupOf(node.slot.kind);
      contributions.push({
        id: node.id,
        name: node.slot.name,
        kind: node.slot.kind,
        group,
        ms,
        calls: attributionScale,
      });
      return;
    }
    if (node.kind === 'sum') {
      node.children.forEach((child) => walk(child, attributionScale));
      return;
    }
    if (node.kind === 'scale') {
      walk(
        node.children[0],
        multiplyFinite(attributionScale, node.n, `criticalLeafContributions.scale.${node.id}`),
      );
      return;
    }

    const maximum = node.children.reduce((current, child) => Math.max(current, child.ms), 0);
    const tolerance = tieRelativeEpsilon * Math.max(Math.abs(maximum), 1);
    const criticalChildren = node.children.filter(
      (child) => Math.abs(child.ms - maximum) <= tolerance,
    );
    const childScale = finiteOperation(
      attributionScale / node.overlap / criticalChildren.length,
      `criticalLeafContributions.max.${node.id}`,
    );
    criticalChildren.forEach((child) => walk(child, childScale));
  }

  walk(root, 1);
  const attributedMs = contributions.reduce(
    (total, contribution) =>
      addFinite(total, contribution.ms, 'criticalLeafContributions.attributedMs'),
    0,
  );
  // Match Analyzer's final normalization: remove only floating-point fold
  // drift after the CostTree algebra has selected the owning critical leaves.
  const normalization = attributedMs > 0 ? root.totalMs / attributedMs : 0;
  return contributions
    .map((contribution) => {
      const ms = multiplyFinite(
        contribution.ms,
        normalization,
        `criticalLeafContributions.${contribution.id}`,
      );
      return {
        ...contribution,
        ms,
        pct: finitePct(ms, root.totalMs, `criticalLeafContributions.${contribution.id}.pct`),
      };
    })
    .sort((left, right) => right.ms - left.ms);
}

/** Aggregate exact critical-path leaf contributions for breakdown charts. */
export function criticalLeafTotals(root: CostTree): LeafTotals {
  const byName = new Map<string, LeafPosition>();
  const byGroup = new Map<string, number>();
  criticalLeafContributions(root).forEach((contribution) => {
    const current = byName.get(contribution.name) ?? {
      name: contribution.name,
      kind: contribution.kind,
      group: contribution.group,
      ms: 0,
      calls: 0,
      pct: 0,
    };
    byName.set(contribution.name, {
      ...current,
      ms: addFinite(current.ms, contribution.ms, `criticalLeafTotals.${contribution.name}.ms`),
      calls: addFinite(
        current.calls,
        contribution.calls,
        `criticalLeafTotals.${contribution.name}.calls`,
      ),
    });
    byGroup.set(
      contribution.group,
      addFinite(
        byGroup.get(contribution.group) ?? 0,
        contribution.ms,
        `criticalLeafTotals.${contribution.group}.ms`,
      ),
    );
  });

  const pct = (ms: number, path: string) => finitePct(ms, root.totalMs, path);
  const positions = [...byName.values()]
    .map((position) => ({
      ...position,
      pct: pct(position.ms, `criticalLeafTotals.${position.name}.pct`),
    }))
    .sort((left, right) => right.ms - left.ms);
  const groups = [...byGroup.entries()]
    .map(([group, ms]) => ({
      group,
      label: GROUP[group].label,
      color: GROUP[group].color,
      ms,
      pct: pct(ms, `criticalLeafTotals.${group}.pct`),
    }))
    .sort((left, right) => right.ms - left.ms);
  return { positions, groups, totalMs: root.totalMs };
}

// ---- formatting and lookup -------------------------------------------------
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
