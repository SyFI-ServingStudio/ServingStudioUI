/**
 * Pure transformations of a `Focus`.
 *
 * These exist so that one rule lives in exactly one place: **changing a
 * coordinate invalidates every coordinate below it**. The old store spelled that
 * rule out again in each of `setCluster`, `selectPool`, `selectWorker`,
 * `selectKernel` and `selectParallel`, and any panel that spreads
 * `{ ...focus, path: [...] }` by hand is another chance to leave a stale worker
 * hanging under a newly selected pool.
 *
 * Nothing here validates. A selection that cannot be addressed produces a path
 * `focusSchema` rejects, and `navigate` reports that in development — one gate,
 * one report, rather than an error branch at every call site.
 *
 * **What these functions deliberately do not do** is decide whether `panel`,
 * `cursorMs` or `options` still make sense after the path moves. Each one changes
 * only the field it names. The old store bundled that policy into every selection
 * action — `selectPool` cleared `runPanelId`, `setTime` cleared the operation —
 * which is why the policy was impossible to state in one place.
 *
 * Deciding it needs the panel registry (which segments a panel consumes, which
 * option keys it claims), so it belongs to the navigation assembly in `app/` at
 * the commit point, not here. Until that layer exists these helpers preserve
 * those fields, and the obligation is recorded in `new-design.md`.
 */
import { canFollow } from './segments';
import type { Focus, PanelOptions, Segment, SegmentKind } from './types';

export function withPath(focus: Focus, path: readonly Segment[]): Focus {
  return { ...focus, path: [...path] };
}

/**
 * Make `segment` the selected coordinate, dropping whatever it invalidates.
 *
 * Not strictly a descent: selecting `pool:prefill` from
 * `pool:decode.worker:3.operation:12~4~7` yields just `pool:prefill`, replacing an
 * ancestor and shortening the path, because that worker belonged to the other
 * pool.
 */
export function selectSegment(focus: Focus, segment: Segment): Focus {
  return withPath(focus, [...keepablePrefix(focus.path, segment), segment]);
}

function keepablePrefix(path: readonly Segment[], segment: Segment): readonly Segment[] {
  for (let end = path.length; end > 0; end -= 1) {
    if (canFollow(path[end - 1].at, segment.at)) return path.slice(0, end);
  }
  return [];
}

/**
 * The path up to and including its outermost `at` segment, or the whole-result
 * view when the path has none. This is "go back up to the pool".
 */
export function upTo(focus: Focus, at: SegmentKind): Focus {
  const index = focus.path.findIndex((segment) => segment.at === at);
  return withPath(focus, index === -1 ? [] : focus.path.slice(0, index + 1));
}

/** The whole result, with no coordinate selected. */
export function atRoot(focus: Focus): Focus {
  return withPath(focus, []);
}

export function withCursor(focus: Focus, cursorMs: number | null): Focus {
  return { ...focus, cursorMs };
}

export function withPanel(focus: Focus, panel: string | null): Focus {
  return { ...focus, panel };
}

/** `null` removes the option, which is how a panel returns to its default. */
export function withOption(focus: Focus, key: string, value: string | null): Focus {
  const options: PanelOptions = { ...focus.options };
  if (value === null) delete options[key];
  else options[key] = value;
  return { ...focus, options };
}
