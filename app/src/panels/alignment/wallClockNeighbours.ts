import { useQueryClient } from '@tanstack/react-query';

import {
  alignmentTimelineIterationRef,
  isAlignmentTimelineArtifactKey,
  useArtifacts,
  type AlignmentTimelineIterationRef,
} from '../../artifacts';
import type { ResultRef } from '../../location';
import type {
  AlignmentTimelineIndex,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';
import { neighbourIterationIds } from './iterationPicker';

/**
 * The selected iteration's two neighbours, fetched beside it.
 *
 * The lanes draw three iterations on one axis because the interesting number is
 * the wall clock BETWEEN them: the gap from one iteration's last kernel to the
 * next one's first is invisible to any view that shows one iteration at a time,
 * and on this capture it is larger than every gap inside either of them.
 *
 * The selected detail is owned by AlignmentPage; this helper receives the same
 * opaque alignment id and uses the same repository query for the two optional
 * neighbours. It never constructs a transport URL itself.
 */

export interface NeighbourIterations {
  /** The neighbours that have arrived, keyed by their role. A neighbour that
   * the capture never recorded, or whose fetch has not resolved, is absent —
   * the scene then draws what it has rather than a placeholder lane. */
  readonly before: AlignmentTimelineIteration | null;
  readonly after: AlignmentTimelineIteration | null;
  /** How many of the three the capture can offer at all. */
  readonly requested: number;
  readonly loaded: number;
  /** Iterations of this subject held in the query cache, which is what makes
   * stepping through the picker cheap after the first pass. */
  readonly cached: number;
  /** A neighbour is optional, but a failed neighbour request is not the same as
   * an edge of the capture where no neighbour exists. */
  readonly error: unknown;
}

export function useNeighbourIterations(
  result: ResultRef & { readonly kind: 'alignment' },
  index: AlignmentTimelineIndex,
  selectedIterationId: number | null,
  selected: AlignmentTimelineIteration | null,
): NeighbourIterations {
  const detailAvailable = index.iterationDetail !== null;
  const { before, after } = neighbourIterationIds(index.iterations, selectedIterationId);
  const neighbourIds = detailAvailable
    ? [before, after].filter((id): id is number => id !== null)
    : [];
  const refs: AlignmentTimelineIterationRef[] = neighbourIds.map((id) =>
    alignmentTimelineIterationRef(result, id),
  );
  const reads = useArtifacts(refs);
  const byId = new Map(
    neighbourIds.flatMap((id, index) => {
      const read = reads[index];
      return read?.status === 'ready' ? [[id, read.value] as const] : [];
    }),
  );
  const client = useQueryClient();
  const cached = client
    .getQueryCache()
    .findAll({ queryKey: ['artifact'] })
    .filter((query) => {
      if (query.state.data === undefined || typeof query.queryKey[1] !== 'string') return false;
      return isAlignmentTimelineArtifactKey(query.queryKey[1], result);
    }).length;

  const requested =
    (selectedIterationId === null ? 0 : 1) + (before === null ? 0 : 1) + (after === null ? 0 : 1);
  const beforeData = before === null ? null : (byId.get(before) ?? null);
  const afterData = after === null ? null : (byId.get(after) ?? null);
  return {
    before: beforeData,
    after: afterData,
    requested,
    loaded:
      (selected === null ? 0 : 1) + (beforeData === null ? 0 : 1) + (afterData === null ? 0 : 1),
    cached,
    error: reads.find((read) => read.status !== 'ready' && read.status !== 'pending') ?? null,
  };
}
