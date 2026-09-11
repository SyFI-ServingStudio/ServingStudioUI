import { costTreeDisplayLabel, type CostNode } from '../costTreeModel';
import type {
  OptimalityKernelLadderData,
  OptimalityKernelLadderKernel,
  OptimalityKernelRungs,
} from '../../artifacts';

/** Slot names of every leaf under the node with `id`, or null when the id is
 * absent. The set keys ladder rows, whose kernel names are these slot names. */
export function scopedLeafNames(root: CostNode, id: number): ReadonlySet<string> | null {
  let scope: CostNode | null = null;
  const find = (node: CostNode): void => {
    if (scope !== null) return;
    if (node.id === id) {
      scope = node;
      return;
    }
    if (node.kind !== 'leaf') node.children.forEach(find);
  };
  find(root);
  if (scope === null) return null;
  const names = new Set<string>();
  const collect = (node: CostNode): void => {
    if (node.kind === 'leaf') {
      names.add(node.slot.name);
      return;
    }
    node.children.forEach(collect);
  };
  collect(scope);
  return names;
}

/** Leaf slot name → nearest labeled ancestor container's compact caption.
 * Leaves without any labeled ancestor keep their own name, so component
 * grouping never merges unrelated top-level kernels. */
export function componentByLeafName(root: CostNode): ReadonlyMap<string, string> {
  const components = new Map<string, string>();
  const walk = (node: CostNode, component: string | null): void => {
    if (node.kind === 'leaf') {
      components.set(node.slot.name, component ?? node.slot.name);
      return;
    }
    const label = node.label === undefined ? component : costTreeDisplayLabel(node.label);
    node.children.forEach((child) => walk(child, label));
  };
  walk(root, null);
  return components;
}

/** Restrict a kernel ladder to the named leaves. Idle and imbalance are
 * scope-wide scheduler facts with no leaf attribution, and R7 scope-fused is
 * reconciled only at the whole scope, so all three leave the filtered view
 * rather than pretending to be subtree quantities. */
export function filterLadderKernels<T extends OptimalityKernelLadderData>(
  data: T,
  names: ReadonlySet<string>,
): T {
  return {
    ...data,
    kernels: data.kernels.filter((kernel) => names.has(kernel.name)),
    specialChunks: { idle: 0, imbalance: 0 },
    rungs: { ...data.rungs, scopeFusedNecessary: null },
  };
}

/** Per-row divisors for the per-call ladder view. Kernel granularity divides
 * by each leaf's call count (occurrences × Scale factors on the path);
 * component granularity divides by the labeled container's instance count
 * (the Scale product above it), so a 28-layer operator reads as one layer's
 * cost. Self-named components (leaves without a labeled ancestor) fall back
 * to their own call count. */
export function perCallDivisors(
  root: CostNode,
  granularity: 'kernel' | 'component',
): ReadonlyMap<string, number> {
  const leafCalls = new Map<string, number>();
  const componentInstances = new Map<string, number>();
  const walk = (node: CostNode, multiplier: number): void => {
    if (node.kind === 'leaf') {
      leafCalls.set(node.slot.name, (leafCalls.get(node.slot.name) ?? 0) + multiplier);
      return;
    }
    if (node.label !== undefined) {
      const caption = costTreeDisplayLabel(node.label);
      componentInstances.set(caption, (componentInstances.get(caption) ?? 0) + multiplier);
    }
    const next = node.kind === 'scale' ? multiplier * node.n : multiplier;
    node.children.forEach((child) => walk(child, next));
  };
  walk(root, 1);
  if (granularity === 'kernel') return leafCalls;
  return new Map([...leafCalls, ...componentInstances]);
}

/** Per-call view of a kernel ladder: each row's rungs divide by its divisor.
 * Bars intentionally stop summing to the model-level rung totals — this is a
 * per-invocation comparison view, not a decomposition. Idle/imbalance are
 * scope-wide scheduler aggregates and R7 is reconciled only at the whole
 * scope, so both leave the view; per-kernel necessary-work attribution does
 * not survive the rescale either. */
export function normalizeLadderPerCall<T extends OptimalityKernelLadderData>(
  data: T,
  divisorOf: ReadonlyMap<string, number>,
): T {
  const kernels = data.kernels.map((kernel) => {
    const divisor = divisorOf.get(kernel.name) || 1;
    const rungs: OptimalityKernelRungs = {
      balanced: kernel.rungs.balanced / divisor,
      perConfigBest: kernel.rungs.perConfigBest / divisor,
      ignoreNetwork: kernel.rungs.ignoreNetwork / divisor,
      hardwareLimit: kernel.rungs.hardwareLimit / divisor,
    };
    if (kernel.rungs.necessaryLimit !== null && kernel.rungs.necessaryLimit !== undefined) {
      rungs.necessaryLimit = kernel.rungs.necessaryLimit / divisor;
    }
    return { ...kernel, rungs, necessaryWork: null };
  });
  return {
    ...data,
    kernels,
    specialChunks: { idle: 0, imbalance: 0 },
    rungs: { ...data.rungs, scopeFusedNecessary: null },
  };
}

const ADDITIVE_RUNGS = ['balanced', 'perConfigBest', 'ignoreNetwork', 'hardwareLimit'] as const;

/** Re-key a kernel ladder at CostTree-component granularity: one row per
 * component (e.g. `unified.qk_norm`) summing its kernels' additive rungs.
 * Per-kernel necessary-work attribution does not survive the merge and is
 * dropped; the summed `necessaryLimit` (R6) stays exact because segmented
 * floors are additive by definition. */
export function groupLadderByComponent<T extends OptimalityKernelLadderData>(
  data: T,
  componentOf: ReadonlyMap<string, string>,
): T {
  const groups = new Map<string, OptimalityKernelLadderKernel[]>();
  for (const kernel of data.kernels) {
    const component = componentOf.get(kernel.name) ?? kernel.name;
    const members = groups.get(component);
    if (members === undefined) groups.set(component, [kernel]);
    else members.push(kernel);
  }
  const kernels = [...groups.entries()].map(([component, members]) => {
    const rungs: OptimalityKernelRungs = {
      balanced: 0,
      perConfigBest: 0,
      ignoreNetwork: 0,
      hardwareLimit: 0,
    };
    for (const member of members) {
      for (const rung of ADDITIVE_RUNGS) rungs[rung] += member.rungs[rung];
      if (member.rungs.necessaryLimit !== null && member.rungs.necessaryLimit !== undefined) {
        rungs.necessaryLimit = (rungs.necessaryLimit ?? 0) + member.rungs.necessaryLimit;
      }
    }
    // The component's dominant kind keeps group coloring meaningful; a mixed
    // component is colored by whichever kind holds the most hardware-limit time.
    const dominant = members.reduce((left, right) =>
      right.rungs.hardwareLimit > left.rungs.hardwareLimit ? right : left,
    );
    return {
      name: component,
      kind: dominant.kind,
      isComm: members.every((member) => member.isComm),
      rungs,
      necessaryWork: null,
    };
  });
  return { ...data, kernels };
}
