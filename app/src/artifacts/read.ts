/**
 * Reading an artifact from a component.
 *
 * A hook that takes a ref and returns an `ArtifactResult`. There is no
 * provider to install, no repository to thread down, and nothing to arrange
 * before the first render — which is what lets a panel be the direct target of
 * a URL rather than something only reachable after a parent has fetched.
 */
import { useQueries, useQuery, type UseQueryOptions } from '@tanstack/react-query';

import { fetchArtifact } from './client';
import { artifactKey, type ArtifactRef, type ArtifactValue } from './ref';
import type { ArtifactResult } from './result';

const PENDING: ArtifactResult<never> = { status: 'pending' };

/**
 * React Query options for one ref.
 *
 * `retry: false` because the six states already distinguish the outcomes worth
 * retrying from the ones that are not, and retrying a `404` three times only
 * delays telling the user that this Analyzer does not serve the artifact. A
 * transport failure is the one case worth another attempt, and it is cheaper to
 * let the user ask again than to hide four seconds of silence behind a spinner.
 */
function optionsFor(ref: ArtifactRef) {
  return {
    queryKey: ['artifact', artifactKey(ref)],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchArtifact(ref, signal),
    retry: false,
  } satisfies UseQueryOptions<ArtifactResult<unknown>>;
}

/**
 * The single unchecked step in this module.
 *
 * `fetchArtifact` is deliberately non-generic — it decodes by switching on
 * `ref.kind`, and TypeScript cannot carry that narrowing back out to a caller's
 * type parameter. `ArtifactValue<R>` states the correspondence that the switch
 * in `client.ts` implements, and it is checked there against each schema's
 * inferred type; this assertion is where the two meet.
 */
function typed<R extends ArtifactRef>(
  result: ArtifactResult<unknown>,
): ArtifactResult<ArtifactValue<R>> {
  return result as ArtifactResult<ArtifactValue<R>>;
}

/** Imperative form for application boundaries such as link resolution. */
export async function readArtifact<R extends ArtifactRef>(
  ref: R,
  signal?: AbortSignal,
): Promise<ArtifactResult<ArtifactValue<R>>> {
  return typed<R>(await fetchArtifact(ref, signal));
}

export function useArtifact<R extends ArtifactRef>(ref: R): ArtifactResult<ArtifactValue<R>> {
  const query = useQuery(optionsFor(ref));
  return typed<R>(query.data ?? PENDING);
}

/** Read one artifact and retain the explicit retry command for transport failures. */
export function useArtifactWithRetry<R extends ArtifactRef>(
  ref: R,
): {
  readonly result: ArtifactResult<ArtifactValue<R>>;
  readonly retry: () => void;
} {
  const query = useQuery(optionsFor(ref));
  return {
    result: typed<R>(query.data ?? PENDING),
    retry: () => void query.refetch(),
  };
}

/**
 * Read several artifacts at once.
 *
 * Each keeps its own state, so one kind failing does not take the others with
 * it — the catalog's six lists are exactly this case. The returned array is
 * positionally aligned with `refs`.
 */
export function useArtifacts<R extends ArtifactRef>(
  refs: readonly R[],
): ArtifactResult<ArtifactValue<R>>[] {
  return useQueries({
    queries: refs.map(optionsFor),
    combine: (results) => results.map((result) => typed<R>(result.data ?? PENDING)),
  });
}
