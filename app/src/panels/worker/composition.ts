/**
 * What the worker kernel-time panel draws, as a pure function.
 *
 * Separate from the component for the same reason `panels/catalog/entries.ts`
 * is: every rule below — which families appear, in what order, whether the
 * numbers may be called exact — is a decision worth a test that needs no
 * renderer and no DOM.
 *
 * The projection takes the two reads it needs and nothing else. It does not
 * fetch, and it does not know that the worker's segments arrive from a second
 * address; it only knows that both may be absent, and says which.
 */
import type {
  KernelTimeShare,
  WorkerCoordinate,
  WorkerKernelComposition,
  WorkerKernelIndexEntry,
} from '../../artifacts';
import { KERNEL_TIME_EPSILON_MS } from '../../artifacts/schema/kernelTimeShare';
import { familyShares, percentOf, type KernelFamilyShare } from '../kernelFamilies';
import { GROUP, groupOf, kindLabel } from '../kernelTaxonomy';

export interface CompositionSlice {
  readonly position: string;
  /** The kernel kind's display name, not its wire spelling. */
  readonly kind: string;
  readonly family: string;
  readonly label: string;
  readonly color: string;
  readonly kernelTimeMs: number;
  readonly sharePct: number;
}

export interface WorkerComposition {
  readonly worker: WorkerCoordinate;
  readonly kernelTimeMs: number;
  /** The worker's share of the whole result's critical-path kernel time. */
  readonly resultSharePct: number;
  readonly slices: readonly CompositionSlice[];
  readonly families: readonly KernelFamilyShare[];
  /** True when every row of this worker's cost log was replayed. Totals are
   * exact either way; only the mixture across positions can be sampled. */
  readonly mixtureExact: boolean;
  readonly rawRows: number;
  readonly sampledRows: number;
}

/**
 * Three outcomes keep run identity separate from scoped-read availability.
 *
 * `absent` is knowable from the cluster index. `unread` says only that no
 * composition for an indexed worker was supplied and goes away by fetching
 * that worker's payload. A zero-time composition remains `ready` so the old
 * ChartCard can preserve its sampling subtitle and fixed geometry while
 * showing the empty message in the plot area.
 */
export type WorkerCompositionProjection =
  | { readonly status: 'ready'; readonly value: WorkerComposition }
  | { readonly status: 'absent'; readonly reason: string }
  | { readonly status: 'unread'; readonly worker: WorkerCoordinate };

function sameWorker(left: WorkerCoordinate, right: WorkerCoordinate): boolean {
  return left.poolTag === right.poolTag && left.workerId === right.workerId;
}

export function workerLabel(worker: WorkerCoordinate): string {
  return `${worker.poolTag}/${worker.workerId}`;
}

function indexEntry(
  share: KernelTimeShare,
  worker: WorkerCoordinate,
): WorkerKernelIndexEntry | undefined {
  return share.workers.find((candidate) => sameWorker(candidate.worker, worker));
}

/**
 * The two reads into one drawable value.
 *
 * `composition` is optional because it arrives from its own address and may
 * still be in flight. It is also `unread` here when it names a different
 * worker, which is the same situation from this function's side: whatever the
 * caller has in hand is not this worker's composition.
 */
export function projectWorkerComposition(
  share: KernelTimeShare,
  worker: WorkerCoordinate,
  composition: WorkerKernelComposition | undefined,
): WorkerCompositionProjection {
  const indexed = indexEntry(share, worker);
  if (indexed === undefined) {
    return {
      status: 'absent',
      reason: `This result has no worker ${workerLabel(worker)}.`,
    };
  }
  if (composition === undefined || !sameWorker(composition.worker, worker)) {
    return { status: 'unread', worker };
  }

  const totalMs = composition.kernelTimeMs;
  // Kept as the wire spells them, because the family totals below are summed
  // from `kind` and a slice carries the kind's *display name* instead. Grouping
  // the display names put every family in "Other" — silently, since `groupOf`
  // answers for any string.
  const kept = composition.segments.filter(
    (segment) => segment.kernelTimeMs > KERNEL_TIME_EPSILON_MS,
  );
  const slices = kept
    .map((segment): CompositionSlice => {
      const family = groupOf(segment.kind);
      return {
        position: segment.position,
        kind: kindLabel(segment.kind),
        family,
        label: GROUP[family].label,
        color: GROUP[family].color,
        kernelTimeMs: segment.kernelTimeMs,
        // Recomputed rather than taken from the wire, so that every percentage
        // on this panel is this projection's own ratio of the times beside it.
        // Mixing the two sources would make the bar and the number under it two
        // independently maintained answers to one question.
        sharePct: percentOf(segment.kernelTimeMs, totalMs),
      };
    })
    .sort(
      (left, right) =>
        right.kernelTimeMs - left.kernelTimeMs || left.position.localeCompare(right.position),
    );

  const resultTimeMs = share.overall.kernelTimeMs;
  const overallByFamily = new Map<string, number>();
  for (const segment of share.overall.segments) {
    const family = groupOf(segment.kind);
    overallByFamily.set(family, (overallByFamily.get(family) ?? 0) + segment.kernelTimeMs);
  }
  const families = [...familyShares(kept, totalMs)].sort(
    (left, right) =>
      (overallByFamily.get(right.family) ?? 0) - (overallByFamily.get(left.family) ?? 0) ||
      left.family.localeCompare(right.family),
  );
  return {
    status: 'ready',
    value: {
      worker,
      kernelTimeMs: totalMs,
      resultSharePct: percentOf(totalMs, resultTimeMs),
      slices,
      families,
      mixtureExact: composition.sampling.sampledRows === composition.sampling.rawRows,
      rawRows: composition.sampling.rawRows,
      sampledRows: composition.sampling.sampledRows,
    },
  };
}
