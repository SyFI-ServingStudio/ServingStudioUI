/**
 * A measured run's page.
 *
 * Sections are numbered in the order a reader works through a run: what was
 * run, where it ran, then what is at the depth they have drilled to. The last
 * one is a function of the focus because its contents *are* the drill-down —
 * naming fixed ids there would mean listing every panel and hiding most of
 * them, which is the arrangement this replaces.
 *
 * Panels not yet ported are simply absent. A section with nothing in it renders
 * as nothing, so the page grows as the port proceeds instead of showing
 * placeholders for work that has not been done.
 */
import { panelsAt } from '../panels/registry';
import { segmentOf, type Focus } from '../location';
import type { LayoutSpec, Section } from './types';

const CLUSTER_OUTCOME = [
  'run.slo',
  'run.throughput',
  'run.utilization',
  'run.checks',
  'run.queue',
  'run.kernel-time',
] as const;

function clusterOutcome(focus: Focus): readonly string[] {
  return focus.path.length === 0 ? CLUSTER_OUTCOME : [];
}

/** The old analysis stage showed exactly one depth at a time. */
function deepestPanelRows(focus: Focus): readonly (readonly string[])[] {
  const selected = focus.path.at(-1)?.at;
  if (selected === undefined) return [];
  const applicable = panelsAt('run', focus).filter((spec) => spec.consumes.length > 0);
  const ids = applicable.filter((spec) => spec.consumes.at(-1) === selected).map((spec) => spec.id);
  const resources = ids.filter((id) => id.endsWith('.utilization') || id.endsWith('.kv'));
  const remaining = ids.filter((id) => !resources.includes(id));
  return [...(resources.length > 0 ? [resources] : []), ...remaining.map((id) => [id])];
}

function deepestPanels(focus: Focus): readonly string[] {
  return deepestPanelRows(focus).flat();
}

function scopeTitle(focus: Focus): string {
  const pool = segmentOf(focus.path, 'pool');
  const worker = segmentOf(focus.path, 'worker');
  if (worker !== null) return `Worker · ${pool?.role ?? '—'}/${worker.id}`;
  return `Pool · ${pool?.role ?? '—'}`;
}

function scopeSub(focus: Focus): string {
  return segmentOf(focus.path, 'worker') === null
    ? 'utilization · KV occupancy · batch composition · kernel time'
    : 'worker aggregate resources · kernel composition';
}

function scopeControl(focus: Focus) {
  if (segmentOf(focus.path, 'worker') === null) return null;
  return {
    kind: 'panel-toggle' as const,
    ariaLabel: 'Worker analysis level',
    value: 'worker',
    options: [
      { value: 'worker', label: 'Worker', panel: null, upTo: 'worker' as const },
      {
        value: 'iteration',
        label: 'Iteration',
        panel: 'worker.cost-tree',
        upTo: 'worker' as const,
      },
    ],
  };
}

const OVERVIEW: Section = { title: '00 Overview', heading: false, panels: ['run.headline'] };
const SYSTEM_MAP: Section = {
  title: '01 System map',
  frame: {
    idx: '01',
    title: 'System map',
    sub: 'deployment · click to scope',
    accent: 'structure',
  },
  panels: ['run.system-map', 'run.timeline'],
  spacing: 1.5,
};
const CLUSTER: Section = {
  title: '02 Cluster outcome',
  frame: {
    idx: '02',
    title: 'Cluster outcome',
    sub: 'SLO · throughput · conservation — whole deployment',
    accent: 'analysis',
  },
  panels: clusterOutcome,
};
const OPTIMALITY: Section = {
  title: '03 Optimality analysis',
  frame: {
    idx: '03',
    title: 'Optimality analysis',
    sub: 'R0-R5 · batching · communication · hardware headroom',
    accent: 'optimality',
  },
  panels: ['run.optimality'],
};
const SCOPE: Section = {
  title: '02 Scope',
  frame: {
    idx: '02',
    title: scopeTitle,
    sub: scopeSub,
    accent: 'analysis',
    control: scopeControl,
  },
  // Only the panels that are *about* the drill-down. A panel that consumes no
  // segment is not made relevant by one — the run's throughput is the run's
  // throughput whether or not the reader has opened a worker — so it belongs
  // to a named section above and would otherwise appear twice.
  panels: deepestPanels,
  rows: deepestPanelRows,
};

const WORKER_WORKBENCH: Section = {
  title: '02 Worker detail',
  heading: false,
  panels: ['worker.iteration-workbench'],
};

export const runLayout: LayoutSpec = {
  kind: 'run',
  // One cluster section and one strict order, matching the old ClusterStage.
  // Its first row is the three CDF cards inside run.slo; the rest stack.
  sections: [OVERVIEW, SYSTEM_MAP, CLUSTER, SCOPE, OPTIMALITY],
  modes: {
    // The composite workbench owns the dynamic old section heading and keeps
    // operation/CostTree geometry in one section while the persistent context
    // remains ordinary registry-driven panels.
    'worker-workbench': [OVERVIEW, SYSTEM_MAP, WORKER_WORKBENCH, OPTIMALITY],
  },
};
