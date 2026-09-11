import { describe, expect, it } from 'vitest';

import { EMPTY_FOCUS, type Location, type ResultKind, type Segment } from '../location';
import { resolveResult } from './resolve';

const WORKER: Segment[] = [
  { at: 'pool', role: 'attn' },
  { at: 'worker', id: '0' },
];

function result(
  path: Segment[],
  panel: string | null,
  kind: ResultKind = 'run',
): Extract<Location, { view: 'result' }> {
  return {
    view: 'result',
    ref: { kind, id: 'r1', workspace: 'w_main' },
    focus: { ...EMPTY_FOCUS, path, panel },
    chat: null,
  };
}

describe('resolveResult', () => {
  it('shows the one panel the address names', () => {
    // A link to a panel should land on that panel, not on a page containing it.
    const resolution = resolveResult(result(WORKER, 'worker.kernel-time-share'));
    expect(resolution.status).toBe('panel');
    expect(resolution.status === 'panel' && resolution.panel.id).toBe('worker.kernel-time-share');
  });

  it('keeps page context when the address names the worker workbench mode', () => {
    const resolution = resolveResult(result(WORKER, 'worker.cost-tree'));

    expect(resolution.status).toBe('page');
    const ids =
      resolution.status === 'page'
        ? resolution.sections.flatMap((section) => section.panels.map((spec) => spec.id))
        : [];
    expect(ids).toEqual([
      'run.headline',
      'run.system-map',
      'run.timeline',
      'worker.iteration-workbench',
      'run.optimality',
    ]);
    expect(ids).not.toContain('worker.utilization');
    expect(ids).not.toContain('worker.kernel-time-share');
  });

  it('still applies page-mode path requirements before selecting its layout', () => {
    const resolution = resolveResult(result([{ at: 'pool', role: 'attn' }], 'worker.cost-tree'));

    expect(resolution.status).toBe('unaddressable');
    expect(resolution.status === 'unaddressable' && resolution.outcome).toBe('not-found');
    expect(resolution.status === 'unaddressable' && resolution.reason).toContain('worker');
  });

  it('reports a panel id this build does not have instead of showing the page', () => {
    // Quietly showing something else is how a stale citation stops being
    // noticeable.
    const resolution = resolveResult(result(WORKER, 'run.topology'));
    expect(resolution.status).toBe('unaddressable');
    expect(resolution.status === 'unaddressable' && resolution.outcome).toBe('not-found');
    expect(resolution.status === 'unaddressable' && resolution.reason).toContain('run.topology');
  });

  it('says which segment a panel is missing', () => {
    const resolution = resolveResult(
      result([{ at: 'pool', role: 'attn' }], 'worker.kernel-time-share'),
    );
    expect(resolution.status).toBe('unaddressable');
    expect(resolution.status === 'unaddressable' && resolution.outcome).toBe('not-found');
    expect(resolution.status === 'unaddressable' && resolution.reason).toContain('worker');
  });

  it('refuses a run panel that a link put on another kind of result', () => {
    // `#/result/prediction/p1?panel=run.system-map` parses, names a panel this
    // build has, and has nothing wrong with its path. Without the kind check the
    // map mounts and asks a prediction for a measured run's topology.
    const resolution = resolveResult(result([], 'run.system-map', 'prediction'));
    expect(resolution.status).toBe('unaddressable');
    expect(resolution.status === 'unaddressable' && resolution.outcome).toBe('not-found');
    const reason = resolution.status === 'unaddressable' ? resolution.reason : '';
    expect(reason).toContain('is about run results');
    expect(reason).toContain('names a prediction');
    // And not the other refusal: the reader cannot fix this by opening a pool.
    expect(reason).not.toContain('on the path');
  });

  it('says the kind is wrong even when the path is wrong too', () => {
    // Both preconditions fail here, which is what makes this a test of the
    // precedence rather than of either check: a pool panel on a prediction with
    // nothing on the path. Reporting the missing segment would send the reader
    // looking for a pool on a result that has none to find.
    const resolution = resolveResult(result([], 'pool.kernel-time', 'prediction'));
    const reason = resolution.status === 'unaddressable' ? resolution.reason : '';
    expect(reason).toContain('is about run results');
    expect(reason).not.toContain('on the path');
  });

  it('falls back to the layout when the address names no panel', () => {
    const resolution = resolveResult(result(WORKER, null));
    expect(resolution.status).toBe('page');
    expect(
      resolution.status === 'page' &&
        resolution.sections.flatMap((section) => section.panels.map((spec) => spec.id)),
    ).toEqual([
      'run.headline',
      'run.system-map',
      'run.timeline',
      'worker.utilization',
      'worker.kv',
      'worker.batch',
      'worker.queue',
      'worker.kernel-time-share',
      'run.optimality',
    ]);
  });

  it('drops sections with nothing in them rather than rendering empty headings', () => {
    // At the top of a run there is no drill-down, so the scope section has no
    // panels. A heading with nothing under it reads as a section that failed to
    // load, and the page grows as panels are ported rather than showing
    // placeholders for work that has not been done.
    const resolution = resolveResult(result([], null));
    expect(
      resolution.status === 'page' && resolution.sections.map((section) => section.title),
    ).toEqual(['00 Overview', '01 System map', '02 Cluster outcome', '03 Optimality analysis']);
  });

  it('shows only the selected analysis depth in the drill-down', () => {
    // A panel that consumes no segment is not made relevant by one. Listing it
    // in both places would print the run's headline twice on every worker page.
    const resolution = resolveResult(result(WORKER, null));
    const scope =
      resolution.status === 'page'
        ? (resolution.sections.find((section) => section.title === '02 Scope')?.panels ?? [])
        : [];
    // The old adaptive stage replaced the pool analysis when a worker opened;
    // keeping both would duplicate each subject at two scopes on one page.
    expect(scope.map((spec) => spec.id)).toEqual([
      'worker.utilization',
      'worker.kv',
      'worker.batch',
      'worker.queue',
      'worker.kernel-time-share',
    ]);
  });

  it('does not fall back to worker aggregate panels below worker depth', () => {
    const paths: Segment[][] = [
      [...WORKER, { at: 'operation', iter: '0', batch: '0', op: '0' }],
      [...WORKER, { at: 'leaf', id: 1 }],
      [...WORKER, { at: 'parallel', id: 2 }],
    ];
    for (const path of paths) {
      const resolution = resolveResult(result(path, null));
      const ids =
        resolution.status === 'page'
          ? resolution.sections.flatMap((section) => section.panels.map((spec) => spec.id))
          : [];
      expect(ids).not.toContain('worker.utilization');
      expect(ids).not.toContain('worker.kernel-time-share');
    }
  });

  it('shows the registered alignment composite page', () => {
    const resolution = resolveResult(result([], null, 'alignment'));
    expect(resolution.status).toBe('page');
    expect(
      resolution.status === 'page' &&
        resolution.sections.flatMap((section) => section.panels.map((panel) => panel.id)),
    ).toEqual(['alignment.page']);
  });
});
