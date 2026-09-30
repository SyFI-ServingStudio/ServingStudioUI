import { createContext, useContext } from 'react';

/**
 * Whether the page showing a result can show the catalog. The application
 * can; a result embedded in another page (`src/embed`) cannot, so its pages
 * offer no way back to one.
 */
const CatalogReachable = createContext(true);

export const CatalogReachableProvider = CatalogReachable.Provider;

export function useCatalogReachable(): boolean {
  return useContext(CatalogReachable);
}
