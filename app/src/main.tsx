import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme';
import App from './App';
import { AnalyzerRepositoryProvider } from './application/RepositoryProvider';
import { fixtureAnalyzerRepository } from './repositories/FixtureAnalyzerRepository';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AnalyzerRepositoryProvider repository={fixtureAnalyzerRepository}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <App />
        </ThemeProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
