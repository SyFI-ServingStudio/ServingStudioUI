/*
 * tree.js — cost-tree engine (shared, framework-free global `Tree`)
 *
 * Faithful to VibeSim's cost_manifest wire format, which is a flat `nodes[]`
 * array of combinators over a `slots[]` leaf table:
 *
 *   { "Leaf":  <slot_index> }
 *   { "Sum":   { children:{start,end} } }          // sequential   →
 *   { "Max":   { overlap, children:{start,end} } }  // overlapped   ⇉
 *   { "Scale": { n, children:{start,end} } }        // repeat ×N (e.g. 94 layers)
 *
 * For the prototype we author trees as NESTED objects (what a backend would
 * produce after resolving nodes[]/slots[] into a tree). The important product
 * decision lives here: a `scale` node is a CONTAINER holding ONE subtree; we
 * never expand the N repeats. That is the "flatten but keep the Scale
 * container" behaviour every design consumes.
 *
 * Node shape (nested):
 *   { kind:'sum'|'max'|'scale'|'leaf', label, n?, overlap?, slot?, base?, children? }
 * after annotate():
 *   + { id, ms, pct, depth }
 */
(function () {
  const Tree = {};

  // ---- authoring DSL -------------------------------------------------------
  Tree.leaf = (name, kind, config, base, backend) => ({
    kind: 'leaf',
    slot: { name, kind, config: config || '', backend: backend || null },
    base, // per-invocation ms
  });
  Tree.sum = (label, ...children) => ({ kind: 'sum', label, children });
  Tree.max = (label, overlap, ...children) => ({ kind: 'max', label, overlap, children });
  Tree.scale = (label, n, child) => ({ kind: 'scale', label, n, children: [child] });

  // ---- kernel-kind taxonomy (semantic groups + default palette) ------------
  Tree.KIND = {
    single_gemm:             { group: 'gemm', label: 'GEMM' },
    grouped_gemm:            { group: 'gemm', label: 'Grouped GEMM' },
    flashinfer_attn_prefill: { group: 'attn', label: 'Attn · prefill' },
    flashinfer_attn_decode:  { group: 'attn', label: 'Attn · decode' },
    kv_cache_append:         { group: 'attn', label: 'KV append' },
    rms_norm:                { group: 'norm', label: 'RMSNorm' },
    elementwise:             { group: 'norm', label: 'Elementwise' },
    all_reduce:              { group: 'comm', label: 'AllReduce' },
    p2p_intra:               { group: 'comm', label: 'P2P · intra-NVL' },
    p2p_inter:               { group: 'comm', label: 'P2P · inter-NVL' },
    moe_router:              { group: 'route', label: 'MoE router' },
  };
  Tree.GROUP = {
    gemm:  { label: 'Dense GEMM',  color: '#f5a623' },
    attn:  { label: 'Attention',   color: '#3ec6c6' },
    comm:  { label: 'Collectives', color: '#e0508a' },
    norm:  { label: 'Norm / EW',   color: '#8bb04f' },
    route: { label: 'Routing',     color: '#9b8cff' },
    misc:  { label: 'Other',       color: '#8493a8' },
  };
  Tree.groupOf = (kind) => (Tree.KIND[kind] && Tree.KIND[kind].group) || 'misc';
  Tree.colorOf = (kind) => Tree.GROUP[Tree.groupOf(kind)].color;
  Tree.kindLabel = (kind) => (Tree.KIND[kind] && Tree.KIND[kind].label) || kind;

  // ---- cost aggregation ----------------------------------------------------
  // leaf: base. sum: Σ children. max: overlap→max, else blend toward serial.
  // scale: n × child.
  function cost(node) {
    if (node.kind === 'leaf') return node.base || 0;
    const cs = node.children.map(cost);
    if (node.kind === 'sum') return cs.reduce((a, b) => a + b, 0);
    if (node.kind === 'max') {
      const ov = node.overlap == null ? 1 : node.overlap;
      const mx = Math.max(...cs), sum = cs.reduce((a, b) => a + b, 0);
      return mx * ov + sum * (1 - ov);
    }
    if (node.kind === 'scale') return node.n * cs[0];
    return 0;
  }

  // Annotate every node with id (DFS order), ms, pct-of-root, depth.
  Tree.annotate = (root) => {
    const total = cost(root);
    let id = 0;
    (function walk(node, depth) {
      node.id = id++;
      node.depth = depth;
      node.ms = cost(node);
      node.pct = total > 0 ? (node.ms / total) * 100 : 0;
      (node.children || []).forEach((c) => walk(c, depth + 1));
    })(root, 0);
    root.totalMs = total;
    return root;
  };

  // ---- derived breakdowns (drive the kernel-time-share charts) -------------
  // Weighted leaf totals: Scale multiplies the enclosing multiplier by n.
  // (We count every leaf's busy time, ignoring Max overlap — approximates GPU
  //  busy-time composition, matching analyzer's "sum of slot times".)
  Tree.leafTotals = (root) => {
    const byName = new Map();
    const byGroup = new Map();
    (function walk(node, mult) {
      if (node.kind === 'leaf') {
        const ms = mult * (node.base || 0);
        const name = node.slot.name;
        const g = Tree.groupOf(node.slot.kind);
        const cur = byName.get(name) || { name, kind: node.slot.kind, group: g, ms: 0, calls: 0 };
        cur.ms += ms; cur.calls += mult; byName.set(name, cur);
        byGroup.set(g, (byGroup.get(g) || 0) + ms);
        return;
      }
      const m = node.kind === 'scale' ? mult * node.n : mult;
      (node.children || []).forEach((c) => walk(c, m));
    })(root, 1);
    const totMs = [...byGroup.values()].reduce((a, b) => a + b, 0) || 1;
    const positions = [...byName.values()]
      .map((p) => ({ ...p, pct: (p.ms / totMs) * 100 }))
      .sort((a, b) => b.ms - a.ms);
    const groups = [...byGroup.entries()]
      .map(([g, ms]) => ({ group: g, label: Tree.GROUP[g].label, color: Tree.GROUP[g].color, ms, pct: (ms / totMs) * 100 }))
      .sort((a, b) => b.ms - a.ms);
    return { positions, groups, totalMs: totMs };
  };

  // Small helpers for renderers
  Tree.fmtMs = (ms) => (ms >= 1 ? ms.toFixed(2) + ' ms' : (ms * 1000).toFixed(1) + ' µs');
  Tree.fmtPct = (p) => (p >= 9.95 ? p.toFixed(0) : p.toFixed(1)) + '%';
  Tree.glyph = { sum: '→', max: '⇉', scale: '×', leaf: '•' };

  window.Tree = Tree;
})();
