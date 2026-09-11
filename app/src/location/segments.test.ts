import { describe, expect, it } from 'vitest';

import {
  ALLOWED_PARENTS,
  canFollow,
  decodePath,
  encodePath,
  isValidPath,
  segmentOf,
} from './segments';
import type { Segment, SegmentKind } from './types';

describe('path grammar', () => {
  it('leaves ordinary tokens unescaped so the address bar stays readable', () => {
    const path: Segment[] = [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: 'gpu-3' },
      { at: 'operation', iter: '12', batch: '4', op: '7' },
      { at: 'leaf', id: 31 },
    ];
    expect(encodePath(path)).toBe('pool:decode.worker:gpu-3.operation:12~4~7.leaf:31');
    expect(decodePath(encodePath(path))).toEqual(path);
  });

  it('escapes tokens that contain a delimiter, rather than restricting ids', () => {
    const path: Segment[] = [
      { at: 'pool', role: 'a.b~c:d' },
      { at: 'worker', id: '100%' },
    ];
    const encoded = encodePath(path);
    expect(encoded).toBe('pool:a%2Eb%7Ec%3Ad.worker:100%25');
    expect(decodePath(encoded)).toEqual(path);
  });

  it('rejects a malformed escape instead of returning a mangled token', () => {
    expect(decodePath('pool:%zz')).toBeNull();
  });

  it('rejects the wrong number of values for a segment', () => {
    expect(decodePath('operation:12~4')).toBeNull();
    expect(decodePath('pool:a~b')).toBeNull();
  });

  it('rejects integer ids that have no canonical form', () => {
    const under = (id: string) => decodePath(`pool:decode.worker:3.leaf:${id}`);
    expect(under('007')).toBeNull();
    expect(under('1e3')).toBeNull();
    expect(under('-1')).toBeNull();
    expect(under('')).toBeNull();
    expect(under('0')).toEqual([
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
      { at: 'leaf', id: 0 },
    ]);
  });

  it('rejects an unknown segment kind, so a newer link fails visibly', () => {
    expect(decodePath('rack:4')).toBeNull();
  });
});

describe('structural legality', () => {
  it('requires each segment to refine the one before it', () => {
    expect(isValidPath([{ at: 'pool', role: 'decode' }])).toBe(true);
    // Worker ids are unique only inside a pool.
    expect(isValidPath([{ at: 'worker', id: '3' }])).toBe(false);
    expect(
      isValidPath([
        { at: 'pool', role: 'decode' },
        { at: 'worker', id: '3' },
      ]),
    ).toBe(true);
  });

  it('rules out repeats without a separate rule, because the parent table is acyclic', () => {
    expect(
      isValidPath([
        { at: 'pool', role: 'a' },
        { at: 'pool', role: 'b' },
      ]),
    ).toBe(false);
    expect(canFollow('pool', 'pool')).toBe(false);
  });

  it('has an acyclic parent table, which is what actually forbids a repeat', () => {
    // No kind being its own parent would only rule out *adjacent* repeats; a
    // cycle `A → B → A` would still let one kind appear twice on a legal path,
    // which `segmentOf` and `upTo` assume cannot happen.
    const reaches = (from: SegmentKind, target: SegmentKind, seen: Set<string>): boolean =>
      ALLOWED_PARENTS[from].some((parent) => {
        if (parent === 'root' || seen.has(parent)) return false;
        seen.add(parent);
        return parent === target || reaches(parent, target, seen);
      });
    for (const kind of Object.keys(ALLOWED_PARENTS) as SegmentKind[]) {
      expect(reaches(kind, kind, new Set())).toBe(false);
    }
  });

  it('is enforced when decoding, so a hand-edited hash cannot skip it', () => {
    expect(decodePath('worker:3')).toBeNull();
  });

  it('stays out of resource semantics: a case under a run is well formed here', () => {
    // Whether a run has cases is for `layouts`/`panels` to answer; this module
    // only knows that `case` starts a path.
    expect(decodePath('case:7')).toEqual([{ at: 'case', id: '7' }]);
  });
});

describe('segmentOf', () => {
  it('reads a coordinate by kind so consumers never index by position', () => {
    const path: Segment[] = [
      { at: 'pool', role: 'decode' },
      { at: 'worker', id: '3' },
    ];
    expect(segmentOf(path, 'worker')).toEqual({ at: 'worker', id: '3' });
    expect(segmentOf(path, 'leaf')).toBeNull();
  });
});
