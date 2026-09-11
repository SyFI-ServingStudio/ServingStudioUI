import { describe, expect, it } from 'vitest';

import { EMPTY_FOCUS, type Location, type Segment } from '../location';
import { prune } from './commit';

const WORKER: Segment[] = [
  { at: 'pool', role: 'attn' },
  { at: 'worker', id: '0' },
];

function at(path: Segment[], panel: string | null, options: Record<string, string> = {}): Location {
  return {
    view: 'result',
    ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
    focus: { ...EMPTY_FOCUS, path, panel, options },
    chat: null,
  };
}

function panelOf(location: Location): string | null {
  return location.view === 'result' ? location.focus.panel : null;
}

describe('prune', () => {
  it('keeps a panel whose drill-down is still on the path', () => {
    const location = at(WORKER, 'worker.kernel-time-share');
    expect(prune(location)).toBe(location);
  });

  it('drops a panel when the reader moves above what it needs', () => {
    // The old store expressed this by making `selectPool` clear the run panel
    // id — a policy that existed only as the sum of every selection action.
    expect(
      panelOf(prune(at([{ at: 'pool', role: 'attn' }], 'worker.kernel-time-share'))),
    ).toBeNull();
    expect(panelOf(prune(at([], 'worker.kernel-time-share')))).toBeNull();
  });

  it('keeps the workbench page mode through deeper selection and drops it above worker', () => {
    const operation: Segment[] = [...WORKER, { at: 'operation', iter: '17', batch: '9', op: '0' }];
    const worker = at(WORKER, 'worker.cost-tree');
    expect(prune(worker)).toBe(worker);
    expect(panelOf(prune(at(operation, 'worker.cost-tree')))).toBe('worker.cost-tree');
    expect(panelOf(prune(at([{ at: 'pool', role: 'attn' }], 'worker.cost-tree')))).toBeNull();
  });

  it('drops a panel this build does not have', () => {
    // A link from another deployment, or a citation frozen against a panel that
    // has since been renamed.
    expect(panelOf(prune(at(WORKER, 'run.topology')))).toBeNull();
  });

  it('drops option keys that no longer have a reader', () => {
    const pruned = prune(at(WORKER, 'worker.kernel-time-share', { stat: 'p99' }));
    expect(pruned.view === 'result' ? pruned.focus.options : null).toEqual({});
  });

  it('retains run evidence selection independently from standalone panel routing', () => {
    const location = at(WORKER, null, { 'evidence-panel': 'utilization' });
    expect(prune(location)).toBe(location);
    expect(location.view === 'result' ? location.focus.panel : 'wrong view').toBeNull();
  });

  it('leaves the other views alone', () => {
    const catalog: Location = {
      view: 'catalog',
      filter: { workspace: 'w_main', kinds: [], query: null },
    };
    expect(prune(catalog)).toBe(catalog);
  });

  it('returns the same object when nothing needed pruning', () => {
    // Identity matters: `navigate` skips a write when the address is unchanged,
    // and a fresh object every time would defeat the memoisation above it.
    const location = at(WORKER, null);
    expect(prune(location)).toBe(location);
  });
});
