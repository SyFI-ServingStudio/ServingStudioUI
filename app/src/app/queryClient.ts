import { QueryClient } from '@tanstack/react-query';

/**
 * Analyzer artifacts are immutable, so a cached one never goes stale — the
 * revision in its address changes instead. These defaults say exactly that;
 * `artifacts/read.ts` owns per-artifact policy. The application and every
 * embedded viewer get their own client with them.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 30 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
