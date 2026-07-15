/*
 * tree.ts — cost-tree engine (ported from the prototype's shared/tree.js).
 *
 * Faithful to VibeSim's cost_manifest wire form: a tree of combinators over a
 * slot table. `scale` is a CONTAINER holding ONE subtree (the N repeats are
 * never expanded) — that is the "flatten but keep the Scale container" rule.
 */

export type NodeKind = 'sum' | 'max' | 'scale' | 'leaf';

export interface Slot {
  name: string;
  kind: string;
  config: string;
  backend: string | null;
}

export interface CostNode {
  kind: NodeKind;
  label?: string;
  n?: number; // scale
  overlap?: number; // max
  slot?: Slot; // leaf
  base?: number; // leaf per-invocation ms
  children?: CostNode[];
  // filled by annotate():
  id: number;
  depth: number;
  ms: number;
  pct: number;
  totalMs?: number; // root only
}

// ---- authoring DSL (used by fakeData) --------------------------------------
type Raw = Omit<CostNode, 'id' | 'depth' | 'ms' | 'pct'>;

export const leaf = (name: string, kind: string, config: string, base: number, backend?: string): Raw => ({
  kind: 'leaf',
  slot: { name, kind, config: config || '', backend: backend ?? null },
  base,
});
export const sum = (label: string, ...children: Raw[]): Raw => ({ kind: 'sum', label, children: children as CostNode[] });
export const max = (label: string, overlap: number, ...children: Raw[]): Raw => ({
  kind: 'max',
  label,
  overlap,
  children: children as CostNode[],
});
export const scale = (label: string, n: number, child: Raw): Raw => ({ kind: 'scale', label, n, children: [child as CostNode] });

// ---- kernel-kind taxonomy --------------------------------------------------
export const KIND: Record<string, { group: string; label: string }> = {
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

export const GROUP: Record<string, { label: string; color: string }> = {
  gemm: { label: 'Dense GEMM', color: '#f5a623' },
  attn: { label: 'Attention', color: '#3ec6c6' },
  comm: { label: 'Collectives', color: '#e0508a' },
  norm: { label: 'Norm / EW', color: '#8bb04f' },
  route: { label: 'Routing', color: '#9b8cff' },
  misc: { label: 'Other', color: '#8493a8' },
};

export const groupOf = (kind: string): string => KIND[kind]?.group ?? 'misc';
export const colorOf = (kind: string): string => GROUP[groupOf(kind)].color;
export const kindLabel = (kind: string): string => KIND[kind]?.label ?? kind;

// ---- cost aggregation ------------------------------------------------------
function cost(node: CostNode): number {
  if (node.kind === 'leaf') return node.base ?? 0;
  const cs = (node.children ?? []).map(cost);
  if (node.kind === 'sum') return cs.reduce((a, b) => a + b, 0);
  if (node.kind === 'max') {
    const ov = node.overlap == null ? 1 : node.overlap;
    const mx = Math.max(...cs);
    const s = cs.reduce((a, b) => a + b, 0);
    return mx * ov + s * (1 - ov);
  }
  if (node.kind === 'scale') return (node.n ?? 1) * cs[0];
  return 0;
}

export function annotate(root: Raw): CostNode {
  const r = root as CostNode;
  const total = cost(r);
  let id = 0;
  (function walk(node: CostNode, depth: number) {
    node.id = id++;
    node.depth = depth;
    node.ms = cost(node);
    node.pct = total > 0 ? (node.ms / total) * 100 : 0;
    (node.children ?? []).forEach((c) => walk(c, depth + 1));
  })(r, 0);
  r.totalMs = total;
  return r;
}

// ---- derived breakdowns (drive the time-share view) ------------------------
export interface LeafPosition {
  name: string;
  kind: string;
  group: string;
  ms: number;
  calls: number;
  pct: number;
}
export interface LeafGroup {
  group: string;
  label: string;
  color: string;
  ms: number;
  pct: number;
}
export interface LeafTotals {
  positions: LeafPosition[];
  groups: LeafGroup[];
  totalMs: number;
}

export function leafTotals(root: CostNode): LeafTotals {
  const byName = new Map<string, LeafPosition>();
  const byGroup = new Map<string, number>();
  (function walk(node: CostNode, mult: number) {
    if (node.kind === 'leaf') {
      const ms = mult * (node.base ?? 0);
      const name = node.slot!.name;
      const g = groupOf(node.slot!.kind);
      const cur = byName.get(name) ?? { name, kind: node.slot!.kind, group: g, ms: 0, calls: 0, pct: 0 };
      cur.ms += ms;
      cur.calls += mult;
      byName.set(name, cur);
      byGroup.set(g, (byGroup.get(g) ?? 0) + ms);
      return;
    }
    const m = node.kind === 'scale' ? mult * (node.n ?? 1) : mult;
    (node.children ?? []).forEach((c) => walk(c, m));
  })(root, 1);
  const totMs = [...byGroup.values()].reduce((a, b) => a + b, 0) || 1;
  const positions = [...byName.values()]
    .map((p) => ({ ...p, pct: (p.ms / totMs) * 100 }))
    .sort((a, b) => b.ms - a.ms);
  const groups = [...byGroup.entries()]
    .map(([g, ms]) => ({ group: g, label: GROUP[g].label, color: GROUP[g].color, ms, pct: (ms / totMs) * 100 }))
    .sort((a, b) => b.ms - a.ms);
  return { positions, groups, totalMs: totMs };
}

// ---- formatting ------------------------------------------------------------
export const fmtMs = (ms: number): string => (ms >= 1 ? ms.toFixed(2) + ' ms' : (ms * 1000).toFixed(1) + ' µs');
export const fmtPct = (p: number): string => (p >= 9.95 ? p.toFixed(0) : p.toFixed(1)) + '%';

export function leafById(root: CostNode, id: number | null): CostNode | null {
  if (id == null) return null;
  let f: CostNode | null = null;
  (function walk(n: CostNode) {
    if (f) return;
    if (n.id === id && n.kind === 'leaf') { f = n; return; }
    (n.children ?? []).forEach(walk);
  })(root);
  return f;
}
export function nodeById(root: CostNode, id: number | null): CostNode | null {
  if (id == null) return null;
  let f: CostNode | null = null;
  (function walk(n: CostNode) {
    if (f) return;
    if (n.id === id) { f = n; return; }
    (n.children ?? []).forEach(walk);
  })(root);
  return f;
}
export function leafByName(root: CostNode, name: string): CostNode | null {
  let f: CostNode | null = null;
  (function walk(n: CostNode) {
    if (f) return;
    if (n.kind === 'leaf' && n.slot!.name === name) { f = n; return; }
    (n.children ?? []).forEach(walk);
  })(root);
  return f;
}
