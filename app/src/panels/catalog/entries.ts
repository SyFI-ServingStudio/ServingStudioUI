/**
 * Which catalog rows the current address asks for.
 *
 * Separate from `CatalogPage.tsx` because it is a pure function of two values
 * and deserves to be tested as one, without a renderer, a query client, or a
 * DOM.
 */
import { mergeCatalogs, type ArtifactResult, type CatalogEntry } from '../../artifacts';
import type { CatalogFilter } from '../../location';

/**
 * Rows to show, given what came back and what the address asks for.
 *
 * A pure function of its two arguments, exported so the filtering rules are
 * testable without rendering. Kinds that are not `ready` contribute nothing
 * here and are reported separately by `ReadFailures` — a list that silently
 * omitted a kind would be indistinguishable from a workspace that has none.
 */
export function visibleEntries(
  results: readonly ArtifactResult<readonly CatalogEntry[]>[],
  filter: CatalogFilter,
): CatalogEntry[] {
  const ready = results.flatMap((result) => (result.status === 'ready' ? [result.value] : []));
  const wanted = new Set(filter.kinds);
  const query = filter.query?.toLocaleLowerCase() ?? null;
  return mergeCatalogs(ready).filter((entry) => {
    if (wanted.size > 0 && !wanted.has(entry.kind)) return false;
    if (query === null) return true;
    return (
      entry.displayName.toLocaleLowerCase().includes(query) ||
      entry.id.toLocaleLowerCase().includes(query)
    );
  });
}
