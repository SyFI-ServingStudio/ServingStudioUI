/**
 * Entry point of the rebuilt application.
 *
 * Its whole job is to mount: a query client, a theme, and `App`. There is no
 * resource bootstrap here — no provider that fetches a run before the route is
 * known, and no repository handed down through context. Panels read what they
 * need through `artifacts/`, keyed by the `Location`.
 *
 * `index.html` boots this production entry.
 */
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import { theme } from '../ui/theme';
import { ApplicationRoot } from './ApplicationRoot';

/**
 * Analyzer artifacts are immutable, so a cached one never goes stale — the
 * revision in its address changes instead. These defaults say exactly that;
 * `artifacts/read.ts` owns per-artifact policy.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ApplicationRoot />
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
