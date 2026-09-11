/**
 * A composition's kernel time, gathered into families.
 *
 * Here rather than in a panel because three scopes ask the same question — a
 * run, a pool, a worker — and each has a panel of its own. Two copies of "sum
 * the segments by family and sort" would drift in the way that does not fail:
 * one chart ordering families by size and another by taxonomy order, showing
 * the same run twice with different answers to "what dominates".
 *
 * The taxonomy itself lives beside this in `taxonomy.ts`; this is only the
 * arithmetic over it.
 */
import { KERNEL_TIME_EPSILON_MS } from '../artifacts/schema/kernelTimeShare';
import { GROUP, groupOf } from './kernelTaxonomy';

export interface KernelFamilyShare {
  readonly family: string;
  readonly label: string;
  readonly color: string;
  readonly kernelTimeMs: number;
  readonly sharePct: number;
}

/** What a family share can be computed from: a kernel kind and its time. */
interface Timed {
  readonly kind: string;
  readonly kernelTimeMs: number;
}

/**
 * Families, largest first.
 *
 * Ordered by time in this scope rather than by a fixed taxonomy order: the
 * question every one of these panels answers is "what dominates *here*", and a
 * constant order buries that answer under whichever family happens to be listed
 * first. Ties fall back to the family name so the order is total and a chart
 * does not reshuffle between renders of identical data.
 *
 * `totalMs` is the scope's own kernel time rather than the sum of what is
 * passed in, because callers filter out segments too small to draw and the
 * shares must still be shares of the whole.
 */
export function familyShares(
  segments: readonly Timed[],
  totalMs: number,
): readonly KernelFamilyShare[] {
  const byFamily = new Map<string, number>();
  for (const segment of segments) {
    const family = groupOf(segment.kind);
    byFamily.set(family, (byFamily.get(family) ?? 0) + segment.kernelTimeMs);
  }
  return [...byFamily.entries()]
    .map(([family, kernelTimeMs]) => ({
      family,
      label: GROUP[family].label,
      color: GROUP[family].color,
      kernelTimeMs,
      sharePct: percentOf(kernelTimeMs, totalMs),
    }))
    .sort(
      (left, right) =>
        right.kernelTimeMs - left.kernelTimeMs || left.family.localeCompare(right.family),
    );
}

/**
 * One time as a percentage of another, and 0 when the whole is nothing.
 *
 * The guard is against the epsilon rather than zero: these totals are sums of
 * floating-point per-position times, so a scope that did no work can arrive
 * here as a very small number rather than as exactly 0, and dividing by it
 * produces a share of several thousand percent.
 */
export function percentOf(partMs: number, wholeMs: number): number {
  return wholeMs <= KERNEL_TIME_EPSILON_MS ? 0 : (partMs / wholeMs) * 100;
}
