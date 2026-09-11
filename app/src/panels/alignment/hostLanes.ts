import type {
  AlignmentHostThread,
  AlignmentHostTimelineMeta,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';

/**
 * The host side of several consecutive iterations, arranged for drawing.
 *
 * Two kinds of row: NVTX ranges, which nest and therefore carry a measured
 * depth, and CUDA runtime calls, which do not nest and carry an API class
 * instead. The analyzer measured that depth rather than assuming an
 * outer/inner split, so a thread whose `forward` sits inside `execute_context`
 * draws as two rows and not as one flat band.
 *
 * Every time the payload gives here is ANCHOR-RELATIVE nanoseconds — the
 * analyzer rebases the host block so that millions of rows stay small numbers,
 * while the measured kernel intervals beside them keep the capture-absolute
 * base. Nothing on this side may have the anchor subtracted from it a second
 * time; it only takes the offset that places its iteration on the shared axis.
 */

// ---- the four drawn lanes -------------------------------------------------

/**
 * Four rows, not one per thread.
 *
 * A capture of a four-rank job carries a dozen host threads, and drawing them
 * all would bury the one relationship the card is about — the reference rank's
 * launches sitting above the reference rank's kernels. So the lanes are the
 * scheduler (which owns no device, and whose time is invisible below), the
 * reference rank's main thread split into its NVTX marks and its runtime calls,
 * and that rank's helper threads folded into one. Every other thread is counted
 * and named as not drawn rather than silently dropped.
 */
export const HOST_LANE_KEYS = ['scheduler', 'workerNvtx', 'workerApi', 'helperApi'] as const;

export type HostLaneKey = (typeof HOST_LANE_KEYS)[number];

/** How deep NVTX nesting is drawn. Deeper marks exist in the capture and are
 * reported as a count: a fourth row would be one pixel of a mark whose name
 * cannot fit anywhere. */
export const HOST_NVTX_DEPTHS = 3;

export interface HostLaneRow {
  /** Stable identity for a visible host call, including after overlapping
   * iteration windows have been deduplicated. */
  readonly id: string;
  /** Milliseconds on the card's shared axis, already carrying the owning
   * iteration's offset. */
  readonly startMs: number;
  readonly endMs: number;
  readonly label: string;
  readonly depth: number;
  readonly apiClassIndex: number | null;
  /** NSYS correlation id for a CUDA runtime launch, if the producer retained it. */
  readonly correlationId: number | null;
}

export interface HostLaneGroup {
  readonly key: HostLaneKey;
  readonly label: string;
  readonly kind: 'nvtx' | 'api';
  readonly rows: readonly HostLaneRow[];
}

export interface HostLaneCensus {
  readonly lanes: readonly HostLaneGroup[];
  readonly nvtxMarks: number;
  /** NVTX marks nested past `HOST_NVTX_DEPTHS`. */
  readonly deeperMarks: number;
  /** Rows the window carries that fall wholly outside the drawn axis. A host
   * window is wider than the axis on both sides, so these exist on every
   * iteration; counting them is the honest statement of what is not on screen. */
  readonly offAxisRows: number;
  /** `classIndex` is the position in the analyzer's own `api_classes`, which is
   * what colours the class — not its position among the classes that happened
   * to appear in this window. */
  readonly apiTotals: readonly {
    readonly class: string;
    readonly classIndex: number;
    readonly calls: number;
    readonly ms: number;
  }[];
  /** Threads the payload carries that these four lanes do not draw. */
  readonly hiddenThreadRoles: readonly string[];
  readonly hiddenThreadCount: number;
  readonly source: string;
  readonly windowRule: string;
  readonly ownershipRule: string;
}

export interface HostLaneWindow {
  readonly iteration: AlignmentTimelineIteration;
  /** Where this iteration's anchor sits on the shared axis. Host rows are
   * ANCHOR-relative already, so this is the only offset they take — subtracting
   * the anchor a second time is the one mistake this whole file guards. */
  readonly offsetMs: number;
}

const NS_PER_MS = 1e6;

function laneLabel(key: HostLaneKey, referenceDeviceId: number): string {
  switch (key) {
    case 'scheduler':
      return 'scheduler';
    case 'workerNvtx':
      return `host/${referenceDeviceId}`;
    case 'workerApi':
      return '└ cuda api';
    case 'helperApi':
      return '└ helpers';
  }
}

/** Which lane a thread's rows of a given kind belong to, or null for a thread
 * these lanes do not draw. */
function laneOf(
  thread: AlignmentHostThread,
  kind: 'nvtx' | 'api',
  referenceDeviceId: number,
): HostLaneKey | null {
  if (thread.deviceId === null) return kind === 'nvtx' ? 'scheduler' : null;
  if (thread.deviceId !== referenceDeviceId) return null;
  if (thread.main) return kind === 'nvtx' ? 'workerNvtx' : 'workerApi';
  return kind === 'api' ? 'helperApi' : null;
}

/**
 * The host rows of several consecutive iterations, on one axis.
 *
 * Rows are deduplicated across windows. Consecutive windows overlap by
 * construction — the analyzer's own `ownership_rule` says an event belongs to
 * every iteration whose window it touches — so the same launch arrives twice
 * and would otherwise be drawn twice, at double opacity, in the exact region
 * where the reader is trying to see one iteration hand over to the next.
 */
export function groupedHostLanes(
  windows: readonly HostLaneWindow[],
  meta: AlignmentHostTimelineMeta | null,
  referenceDeviceId: number,
  /** The drawn axis. Rows wholly outside it are counted rather than kept: a
   * host window reaches past the axis on both sides by construction, and the
   * key would otherwise report calls the reader cannot see. */
  axis: { readonly startMs: number; readonly endMs: number },
): HostLaneCensus | null {
  if (meta === null) return null;
  const rows = new Map<HostLaneKey, Map<string, HostLaneRow>>();
  for (const key of HOST_LANE_KEYS) rows.set(key, new Map());
  let deeperMarks = 0;
  const offAxis = new Set<string>();

  for (const window of windows) {
    const host = window.iteration.host;
    if (host === null) continue;
    for (const kind of ['nvtx', 'api'] as const) {
      const byThread = kind === 'nvtx' ? host.nvtx : host.api;
      for (const [threadKey, events] of Object.entries(byThread)) {
        const thread = meta.threads[Number(threadKey)];
        if (thread === undefined) continue;
        const lane = laneOf(thread, kind, referenceDeviceId);
        if (lane === null) continue;
        const bucket = rows.get(lane)!;
        for (const [startNs, durationNs, stringId, classifier, correlationId] of events) {
          if (kind === 'nvtx' && classifier >= HOST_NVTX_DEPTHS) {
            deeperMarks += 1;
            continue;
          }
          const label = meta.strings[stringId] ?? `string ${stringId}`;
          // Keyed on absolute capture NANOSECONDS, so the same call seen from
          // two windows collapses to one entry whichever iteration owns it.
          // Milliseconds would not: the two windows reach the same instant by
          // different sums of floats, and the last bit of disagreement is
          // enough to draw the overlap region twice, at double opacity.
          const key = `${window.iteration.anchorNs + startNs}|${durationNs}|${label}|${correlationId ?? ''}`;
          const startMs = window.offsetMs + startNs / NS_PER_MS;
          const endMs = startMs + durationNs / NS_PER_MS;
          if (startMs >= axis.endMs || endMs <= axis.startMs) {
            offAxis.add(key);
            continue;
          }
          bucket.set(key, {
            id: `host:${kind}:${lane}:${key}`,
            startMs,
            endMs,
            label,
            depth: kind === 'nvtx' ? classifier : 0,
            apiClassIndex: kind === 'api' ? classifier : null,
            correlationId: kind === 'api' ? (correlationId ?? null) : null,
          });
        }
      }
    }
  }

  const lanes = HOST_LANE_KEYS.map((key) => ({
    key,
    label: laneLabel(key, referenceDeviceId),
    kind: key === 'workerApi' || key === 'helperApi' ? ('api' as const) : ('nvtx' as const),
    rows: [...rows.get(key)!.values()].sort((left, right) => left.startMs - right.startMs),
  }));

  const totals = new Map<number, { calls: number; ms: number }>();
  for (const lane of lanes) {
    if (lane.kind !== 'api') continue;
    for (const row of lane.rows) {
      if (row.apiClassIndex === null) continue;
      const bucket = totals.get(row.apiClassIndex) ?? { calls: 0, ms: 0 };
      bucket.calls += 1;
      bucket.ms += row.endMs - row.startMs;
      totals.set(row.apiClassIndex, bucket);
    }
  }

  const hidden = meta.threads.filter(
    (thread) => thread.deviceId !== null && thread.deviceId !== referenceDeviceId,
  );
  return {
    lanes,
    nvtxMarks: lanes
      .filter((lane) => lane.kind === 'nvtx')
      .reduce((total, lane) => total + lane.rows.length, 0),
    deeperMarks,
    offAxisRows: offAxis.size,
    apiTotals: meta.apiClasses
      .map((name, index) => ({
        class: name,
        classIndex: index,
        ...(totals.get(index) ?? { calls: 0, ms: 0 }),
      }))
      .filter((entry) => entry.calls > 0),
    hiddenThreadRoles: [...new Set(hidden.map((thread) => thread.role))],
    hiddenThreadCount: hidden.length,
    source: meta.source,
    windowRule: meta.windowRule,
    ownershipRule: meta.ownershipRule,
  };
}
