import { createContext, useContext } from 'react';

/**
 * What the page that shows a result offers its pages. The application shows
 * the catalog, and names a result as the catalog does. A page that embeds one
 * result (`src/embed`) shows no catalog, so its pages offer no way to one and
 * read none; it may name the result itself.
 */
export interface ResultHost {
  readonly catalogReachable: boolean;
  /** The result's name as the embedding page gives it. */
  readonly resultName?: string;
}

const ResultHostContext = createContext<ResultHost>({ catalogReachable: true });

export const ResultHostProvider = ResultHostContext.Provider;

export function useCatalogReachable(): boolean {
  return useContext(ResultHostContext).catalogReachable;
}

/**
 * The result's name: the one the page gives, else `fallback` (a name the
 * application derives from its catalog or the result's own documents) where
 * the catalog is reachable. An embedding page that names nothing gets no
 * name, rather than an id standing in for one.
 */
export function useResultName(fallback: string | undefined): string | undefined {
  const host = useContext(ResultHostContext);
  return host.resultName ?? (host.catalogReachable ? fallback : undefined);
}
