import { describe, expect, it } from 'vitest';

import type { ArtifactResult, CatalogEntry } from '../../artifacts';
import type { CatalogFilter } from '../../location';
import { visibleEntries } from './entries';

function row(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    kind: 'run',
    id: 'r1',
    workspace: 'w_main',
    displayName: 'First run',
    status: 'ready',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function ready(...entries: CatalogEntry[]): ArtifactResult<readonly CatalogEntry[]> {
  return { status: 'ready', value: entries, schemaVersion: 1, revision: 'r' };
}

const ALL: CatalogFilter = { workspace: 'w_main', kinds: [], query: null };

describe('visibleEntries', () => {
  it('shows every kind when no kind is selected', () => {
    const shown = visibleEntries([ready(row()), ready(row({ kind: 'sweep', id: 's1' }))], ALL);
    // Equal timestamps, so canonical kind order decides: sweeps above runs.
    expect(shown.map((entry) => entry.id)).toEqual(['s1', 'r1']);
  });

  it('narrows to the selected kinds', () => {
    const shown = visibleEntries([ready(row()), ready(row({ kind: 'sweep', id: 's1' }))], {
      ...ALL,
      kinds: ['sweep'],
    });
    expect(shown.map((entry) => entry.id)).toEqual(['s1']);
  });

  it('keeps rows from every workspace in the global Page 0 catalog', () => {
    const shown = visibleEntries([ready(row({ workspace: 'w_other' }))], ALL);
    expect(shown.map((entry) => entry.workspace)).toEqual(['w_other']);
  });

  it('matches the query against both the name and the id', () => {
    const entries = [row({ id: 'r1', displayName: 'Llama throughput' }), row({ id: 'zz9' })];
    expect(visibleEntries([ready(...entries)], { ...ALL, query: 'llama' })).toHaveLength(1);
    expect(visibleEntries([ready(...entries)], { ...ALL, query: 'zz9' })).toHaveLength(1);
    expect(visibleEntries([ready(...entries)], { ...ALL, query: 'nothing' })).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(
      visibleEntries([ready(row({ displayName: 'Llama' }))], { ...ALL, query: 'LLAMA' }),
    ).toHaveLength(1);
  });

  it('keeps the kinds that did come back when one read failed', () => {
    // The point of six independent reads: one Analyzer route being down must
    // not empty the page.
    const shown = visibleEntries(
      [
        ready(row()),
        { status: 'failed', code: '500', reason: 'boom' },
        { status: 'pending' },
        { status: 'unavailable', reason: 'old build' },
      ],
      ALL,
    );
    expect(shown.map((entry) => entry.id)).toEqual(['r1']);
  });
});
