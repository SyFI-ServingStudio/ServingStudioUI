import { createContext, useContext, type ReactNode } from 'react';

import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';

const AnalyzerRepositoryContext = createContext<AnalyzerRepository | null>(null);

/** Dependency injection boundary: features depend on the repository contract,
 * never on fixture/HTTP implementations or analyzer paths. */
export function AnalyzerRepositoryProvider({
  repository,
  children,
}: {
  repository: AnalyzerRepository;
  children: ReactNode;
}) {
  return (
    <AnalyzerRepositoryContext.Provider value={repository}>
      {children}
    </AnalyzerRepositoryContext.Provider>
  );
}

export function useAnalyzerRepository(): AnalyzerRepository {
  const repository = useContext(AnalyzerRepositoryContext);
  if (!repository) throw new Error('AnalyzerRepositoryProvider is missing from the application root.');
  return repository;
}
