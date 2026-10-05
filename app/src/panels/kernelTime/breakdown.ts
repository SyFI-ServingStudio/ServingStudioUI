/** The old kernel-time chart's data shape, projected from the schema-2 artifact. */
import type { KernelComposition, KernelTimeShare } from '../../artifacts';
import { KERNEL_TIME_EPSILON_MS } from '../../artifacts/schema/kernelTimeShare';
import { familyColor, familyOf, type KernelKinds } from '../kernelTaxonomy';

export interface KernelStackFamily {
  readonly group: string;
  readonly color: string;
}

export interface KernelStackRow {
  readonly label: string;
  readonly total: number;
  readonly byGroup: Readonly<Record<string, number>>;
}

export interface ReadyKernelTimeBreakdown {
  readonly status: 'ready';
  readonly families: readonly KernelStackFamily[];
  readonly rows: readonly KernelStackRow[];
  readonly kernelTimeTotalsExact: true;
  readonly positionMixExact: boolean;
  readonly sampling: {
    readonly method: string;
    readonly rawRows: number;
    readonly sampledRows: number;
  };
}

export type KernelTimeBreakdownProjection =
  ReadyKernelTimeBreakdown | { readonly status: 'absent'; readonly reason: string };

export function hasReportableKernelTime(data: ReadyKernelTimeBreakdown): boolean {
  return data.rows.some((row) => row.total > KERNEL_TIME_EPSILON_MS);
}

function groupTimes(composition: KernelComposition, kinds: KernelKinds): Record<string, number> {
  const byGroup: Record<string, number> = {};
  for (const segment of composition.segments) {
    const group = familyOf(kinds, segment.kind);
    byGroup[group] = (byGroup[group] ?? 0) + segment.kernelTimeMs;
  }
  return byGroup;
}

function row(label: string, composition: KernelComposition, kinds: KernelKinds): KernelStackRow {
  return { label, total: composition.kernelTimeMs, byGroup: groupTimes(composition, kinds) };
}

function familiesFor(
  share: KernelTimeShare,
  rows: readonly KernelStackRow[],
  kinds: KernelKinds,
): readonly KernelStackFamily[] {
  const overall = groupTimes(share.overall, kinds);
  const present = new Set(rows.flatMap((item) => Object.keys(item.byGroup)));
  return [...present]
    .sort(
      (left, right) => (overall[right] ?? 0) - (overall[left] ?? 0) || left.localeCompare(right),
    )
    .map((group) => ({ group, color: familyColor(kinds, group) }));
}

function ready(
  share: KernelTimeShare,
  rows: readonly KernelStackRow[],
  workers: KernelTimeShare['workers'],
  kinds: KernelKinds,
  runSampling = false,
): ReadyKernelTimeBreakdown {
  const rawRows = runSampling
    ? share.sampling.rawRows
    : workers.reduce((total, worker) => total + worker.sampling.rawRows, 0);
  const sampledRows = runSampling
    ? share.sampling.sampledRows
    : workers.reduce((total, worker) => total + worker.sampling.sampledRows, 0);
  return {
    status: 'ready',
    families: familiesFor(share, rows, kinds),
    rows,
    kernelTimeTotalsExact: true,
    positionMixExact: runSampling
      ? share.sampling.exact
      : workers.every((worker) => worker.sampling.sampledRows === worker.sampling.rawRows),
    sampling: { method: share.sampling.method, rawRows, sampledRows },
  };
}

/** The cluster row followed by pool rows, preserving the old chart order. */
export function runBreakdown(share: KernelTimeShare, kinds: KernelKinds): ReadyKernelTimeBreakdown {
  const rows = [
    row('cluster', share.overall, kinds),
    ...share.pools.map((pool) => row(pool.poolTag, pool, kinds)),
  ];
  return ready(share, rows, share.workers, kinds, true);
}

/** The old pool card is a one-row family chart, not a worker ranking. */
export function poolBreakdown(
  share: KernelTimeShare,
  poolTag: string,
  kinds: KernelKinds,
): KernelTimeBreakdownProjection {
  const pool = share.pools.find((candidate) => candidate.poolTag === poolTag);
  if (pool === undefined) {
    return { status: 'absent', reason: `This run has no pool named ${poolTag}.` };
  }
  return ready(
    share,
    [row(pool.poolTag, pool, kinds)],
    share.workers.filter((worker) => worker.worker.poolTag === poolTag),
    kinds,
  );
}
