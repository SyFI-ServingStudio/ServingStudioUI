import { createContext, useContext } from 'react';

/**
 * What the page showing a result offers of the catalog. The application
 * shows the catalog, and names a result as its catalog entry does. A result
 * embedded in another page (`src/embed`) cannot show it, so its pages offer
 * no way back to one; the embedding page may also name the result, and then
 * the pages read no catalog to name it.
 */
export interface CatalogAccess {
  readonly reachable: boolean;
  /** The result's name as the embedding page gives it. */
  readonly name?: string;
}

const CatalogReachable = createContext<CatalogAccess>({ reachable: true });

export const CatalogReachableProvider = CatalogReachable.Provider;

export function useCatalogReachable(): boolean {
  return useContext(CatalogReachable).reachable;
}

/** The result's name when the page gives one, else undefined: its catalog entry names it. */
export function useGivenResultName(): string | undefined {
  return useContext(CatalogReachable).name;
}
