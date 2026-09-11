/**
 * Why the scope section is in the order it is in.
 *
 * The decision, stated: the drill-down section does not list its panels. It
 * asks the registry what applies at the address and shows that, in registry
 * order. Listing them here instead would mean every new panel is added in two
 * places, and the two can disagree — the failure being a panel that resolves at
 * an address but never appears on the page that address opens.
 *
 * What that leaves is an order chosen somewhere the layout cannot see, which is
 * the part worth pinning. The rule is that descending does not rearrange the
 * page: a reader who has been reading utilization, then batches, then memory on
 * the way down finds the same subjects in the same sequence at the depth they
 * open. So the scope section is the sections above, repeated per depth. These
 * two tests are that sentence — they read the layout's own sections and the
 * registry's output and check the second follows the first, so a panel filed in
 * the wrong slot fails here rather than quietly reordering the page.
 */
import { describe, expect, it } from 'vitest';

import { runLayout } from './run';
import { rowsOf, sectionsOf } from './types';
import { EMPTY_FOCUS, type Focus, type Segment } from '../location';
import { panelSpec } from '../panels/registry';

const WORKER: Segment[] = [
  { at: 'pool', role: 'attn' },
  { at: 'worker', id: '0' },
];

const focus: Focus = { ...EMPTY_FOCUS, path: WORKER };

const SCOPE = '02 Scope';

const POOL: Segment[] = [{ at: 'pool', role: 'attn' }];
const DEEPER: readonly Segment[][] = [
  [...WORKER, { at: 'operation', iter: '0', batch: '0', op: '0' }],
  [...WORKER, { at: 'leaf', id: 1 }],
  [...WORKER, { at: 'parallel', id: 2 }],
];

/**
 * Ids that spell one subject two ways.
 *
 * `run.kernel-time` ranks the pools by how much GPU time they spent, and
 * `worker.kernel-time-share` breaks one worker's time down by kernel. Two
 * documents, two ids — and one subject as far as a reader working down the page
 * is concerned, which is what this file is about. Without the alias the worker
 * panel matches nothing above it and drops out of the comparison, leaving the
 * worker depth with a single recognised subject and an ordering rule that
 * agrees with any order.
 */
const ALIASES: Record<string, string> = { 'kernel-time-share': 'kernel-time' };

/** `pool.kernel-time` → `kernel-time`: what the panel is about, at any depth. */
function subject(id: string): string {
  const own = id.slice(id.indexOf('.') + 1);
  return ALIASES[own] ?? own;
}

/** `pool.kernel-time` → `pool`: how deep the reader has to be to see it. */
function depth(id: string): string {
  return id.slice(0, id.indexOf('.'));
}

function panelsOf(title: string): readonly string[] {
  const section = runLayout.sections.find((candidate) => candidate.title === title);
  if (section === undefined) throw new Error(`no section titled ${title}`);
  return typeof section.panels === 'function' ? section.panels(focus) : section.panels;
}

/** The subjects the page names before the reader has descended into anything. */
function above(): readonly string[] {
  return runLayout.sections
    .filter((section) => section.title !== SCOPE)
    .flatMap((section) =>
      typeof section.panels === 'function' ? section.panels(EMPTY_FOCUS) : section.panels,
    )
    .map(subject);
}

describe('the run layout', () => {
  it('reproduces the old run section and cluster-stage order', () => {
    expect(
      runLayout.sections
        .filter((section) => section.title !== SCOPE)
        .map((section) => section.title),
    ).toEqual(['00 Overview', '01 System map', '02 Cluster outcome', '03 Optimality analysis']);
    const cluster = runLayout.sections[2];
    expect(
      typeof cluster.panels === 'function' ? cluster.panels(EMPTY_FOCUS) : cluster.panels,
    ).toEqual([
      'run.slo',
      'run.throughput',
      'run.utilization',
      'run.checks',
      'run.queue',
      'run.kernel-time',
    ]);
    expect(runLayout.sections[1]).toMatchObject({
      title: '01 System map',
      panels: ['run.system-map', 'run.timeline'],
      spacing: 1.5,
    });
    expect(runLayout.sections.at(-1)).toMatchObject({
      title: '03 Optimality analysis',
      panels: ['run.optimality'],
      frame: {
        idx: '03',
        title: 'Optimality analysis',
        sub: 'R0-R5 · batching · communication · hardware headroom',
        accent: 'optimality',
      },
    });
  });

  it('declares a worker workbench page that retains persistent context', () => {
    const spec = panelSpec('worker.cost-tree');
    if (spec?.mode !== 'page') throw new Error('worker.cost-tree is not a page mode');
    const sections = sectionsOf(runLayout, spec.layoutMode);

    expect(sections?.map((section) => section.title)).toEqual([
      '00 Overview',
      '01 System map',
      '02 Worker detail',
      '03 Optimality analysis',
    ]);
    expect(sections?.flatMap((section) => rowsOf(section, focus))).toEqual([
      ['run.headline'],
      ['run.system-map'],
      ['run.timeline'],
      ['worker.iteration-workbench'],
      ['run.optimality'],
    ]);
    expect(sections?.find((section) => section.title === '02 Worker detail')?.heading).toBe(false);
  });

  it('does not silently substitute the default page for an unknown mode', () => {
    expect(sectionsOf(runLayout, 'future-mode')).toBeNull();
  });

  it('keeps the old subject order at the selected depth', () => {
    // Not "is in registry order" — that is true of anything the registry hands
    // back and would pass whatever order the registry was in. This compares the
    // two lists: each depth's panels, in the order the fixed sections put their
    // subjects in. Swapping two panels in the registry, or moving a section on
    // the page, breaks it.
    const fixed = above();
    const scope = panelsOf(SCOPE);
    expect(scope.length).toBeGreaterThan(0);

    const ranks = scope.map((id) => fixed.indexOf(subject(id))).filter((rank) => rank !== -1);
    expect(ranks.length).toBeGreaterThan(1);
    expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  });

  it('shows only the deepest selected scope, as the old adaptive stage did', () => {
    const scope = panelsOf(SCOPE);
    expect(scope.length).toBeGreaterThan(1);
    expect(new Set(scope.map(depth))).toEqual(new Set(['worker']));

    const section = runLayout.sections.find((candidate) => candidate.title === SCOPE);
    const panels = section?.panels;
    const poolFocus: Focus = { ...EMPTY_FOCUS, path: POOL };
    const poolPanels = typeof panels === 'function' ? panels(poolFocus) : panels;
    expect(poolPanels?.length).toBeGreaterThan(1);
    expect(new Set(poolPanels?.map(depth))).toEqual(new Set(['pool']));
  });

  it('puts utilization and KV in the old resource row before the remaining pool panels', () => {
    const section = runLayout.sections.find((candidate) => candidate.title === SCOPE);
    if (section === undefined) throw new Error(`no section titled ${SCOPE}`);
    const poolFocus: Focus = { ...EMPTY_FOCUS, path: POOL };
    expect(rowsOf(section, poolFocus)).toEqual([
      ['pool.utilization', 'pool.kv'],
      ['pool.batch'],
      ['pool.queue'],
      ['pool.kernel-time'],
    ]);
    expect(rowsOf(section, focus)).toEqual([
      ['worker.utilization', 'worker.kv'],
      ['worker.batch'],
      ['worker.queue'],
      ['worker.kernel-time-share'],
    ]);
    expect(section.frame).toMatchObject({
      idx: '02',
      accent: 'analysis',
    });
  });

  it('shows nothing at the top of a run, rather than a heading over an empty page', () => {
    // The same section at the address the reader starts from. Its panels all
    // consume a segment, and there are none, so the section is empty and the
    // page drops it.
    const section = runLayout.sections.find((candidate) => candidate.title === SCOPE);
    const panels = section?.panels;
    expect(typeof panels === 'function' ? panels(EMPTY_FOCUS) : panels).toEqual([]);
  });

  it('keeps cluster analysis out of pool and worker addresses', () => {
    const section = runLayout.sections.find(
      (candidate) => candidate.title === '02 Cluster outcome',
    );
    const panels = section?.panels;
    expect(typeof panels === 'function' ? panels(focus) : panels).toEqual([]);
  });

  it('does not fall back to worker aggregate panels below worker depth', () => {
    const section = runLayout.sections.find((candidate) => candidate.title === SCOPE);
    const panels = section?.panels;
    for (const path of DEEPER) {
      const deeper: Focus = { ...EMPTY_FOCUS, path };
      expect(typeof panels === 'function' ? panels(deeper) : panels).toEqual([]);
    }
  });
});
