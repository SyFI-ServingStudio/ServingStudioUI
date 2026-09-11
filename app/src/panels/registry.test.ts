import { describe, expect, it } from 'vitest';

import { EMPTY_FOCUS, OPTION_KEY_PATTERN, type Focus, type Segment } from '../location';
import { allPanels, claimedOptions, panelSpec, panelsAt } from './registry';

function focusAt(path: Segment[]): Focus {
  return { ...EMPTY_FOCUS, path };
}

const WORKER: Segment[] = [
  { at: 'pool', role: 'attn' },
  { at: 'worker', id: '0' },
];

describe('the registry', () => {
  it('is keyed by each spec’s own id', () => {
    // The URL names a panel by this key, so a spec whose id disagreed with its
    // key would be reachable under one name and described under another.
    for (const spec of allPanels()) {
      expect(panelSpec(spec.id)).toBe(spec);
    }
  });

  it('has nothing under a name it does not know', () => {
    // What the resolver acts on: an id that names no panel is reported to the
    // reader rather than quietly replaced by the page, so "no panel" has to be
    // a plain `null` and not a spec that happens to render nothing.
    expect(panelSpec('worker.kernel-time-share')).not.toBeNull();
    expect(panelSpec('worker.kernel-time-share ')).toBeNull();
    expect(panelSpec('run.topology')).toBeNull();
    expect(panelSpec('')).toBeNull();
  });

  it('distinguishes the workbench page mode from standalone citation panels', () => {
    expect(panelSpec('worker.cost-tree')).toMatchObject({
      mode: 'page',
      layoutMode: 'worker-workbench',
    });
    expect(panelSpec('worker.kernel-time-share')).toMatchObject({ mode: 'panel' });
    expect(panelSpec('worker.iteration-workbench')).toMatchObject({
      mode: 'panel',
      scope: false,
    });
    const scoped = panelsAt('run', focusAt(WORKER)).map((spec) => spec.id);
    expect(scoped).not.toContain('worker.cost-tree');
    expect(scoped).not.toContain('worker.iteration-workbench');
  });

  it('offers a panel only where its drill-down exists', () => {
    // Decided from the address alone, before anything is loaded or fetched.
    expect(panelsAt('run', focusAt(WORKER)).map((spec) => spec.id)).toContain(
      'worker.kernel-time-share',
    );
    expect(
      panelsAt('run', focusAt([{ at: 'pool', role: 'attn' }])).map((spec) => spec.id),
    ).not.toContain('worker.kernel-time-share');
    expect(panelsAt('run', focusAt([])).map((spec) => spec.id)).not.toContain(
      'worker.kernel-time-share',
    );
  });

  it('offers nothing at all on a kind no panel is about', () => {
    // Every panel this build has reads a measured run's subjects. A prediction
    // is a different document set, so the map is not "not yet drilled into" here
    // — it does not apply, and mounting it would ask a prediction for a run's
    // topology.
    expect(panelsAt('prediction', focusAt(WORKER))).toEqual([]);
    expect(panelsAt('run', focusAt(WORKER)).length).toBeGreaterThan(0);
  });

  it('gives every panel a kind it is about', () => {
    // An empty list is a panel no address can reach: dead code that still ships,
    // and one the layouts would silently never show.
    for (const spec of allPanels()) {
      expect(spec.kinds.length).toBeGreaterThan(0);
    }
  });

  it('declares what each panel reads without loading it', () => {
    const spec = panelSpec('worker.kernel-time-share');
    const needs = spec?.needs({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: focusAt(WORKER),
      chat: null,
    });
    expect(needs?.map((ref) => ('kind' in ref ? ref.kind : ref.seq))).toEqual([
      'kernelTimeShare',
      'workerKernelTimeShare',
    ]);
  });

  it('declares run optimality and its batch mode as part of the run page', () => {
    const spec = panelSpec('run.optimality');
    const needs = spec?.needs({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: { ...focusAt([]), options: { optimality: 'batch_locked' } },
      chat: null,
    });
    expect(spec).toMatchObject({ options: ['optimality', 'evidence-panel'], scope: false });
    expect(needs?.map((ref) => ('kind' in ref ? ref.kind : ref.seq))).toEqual([
      'runDescriptor',
      'runOptimality',
    ]);
  });

  it('declares the descriptor gate for the worker workbench mode', () => {
    const spec = panelSpec('worker.cost-tree');
    const needs = spec?.needs({
      view: 'result',
      ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
      focus: focusAt(WORKER),
      chat: null,
    });

    expect(needs?.map((ref) => ('kind' in ref ? ref.kind : ref.seq))).toEqual(['runDescriptor']);
    expect(
      spec?.needs({
        view: 'result',
        ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
        focus: focusAt([]),
        chat: null,
      }),
    ).toEqual([]);
  });

  it('needs nothing at an address it cannot render', () => {
    const spec = panelSpec('worker.kernel-time-share');
    expect(
      spec?.needs({
        view: 'result',
        ref: { kind: 'run', id: 'r1', workspace: 'w_main' },
        focus: focusAt([]),
        chat: null,
      }),
    ).toEqual([]);
  });

  it('gathers every claimed key, however many panels claim it', () => {
    // Sharing a key is allowed, and `run.queue` / `pool.queue` do it: one
    // choice about one panel that renders at two depths. Giving them separate
    // keys would show the reader the average again the moment they opened a
    // pool. What must hold is that the union is complete — `commit` drops
    // anything outside it, and a key missing here is a working option silently
    // stripped from the URL.
    const claimed = claimedOptions();
    for (const spec of allPanels()) {
      for (const key of spec.options) expect(claimed.has(key)).toBe(true);
    }
    expect(claimed.size).toBeLessThanOrEqual(
      allPanels().flatMap((spec) => [...spec.options]).length,
    );
  });

  it('claims only keys a URL can carry', () => {
    // The key is written into the address verbatim, so one outside the
    // grammar's charset would produce a hash `parseLocation` refuses — an
    // option that works until the reader reloads.
    for (const spec of allPanels()) {
      for (const key of spec.options) expect(key).toMatch(OPTION_KEY_PATTERN);
    }
  });
});
