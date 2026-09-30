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
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';

import { theme } from '../ui/theme';
import { ApplicationRoot } from './ApplicationRoot';
import { createQueryClient } from './queryClient';

const queryClient = createQueryClient();

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
