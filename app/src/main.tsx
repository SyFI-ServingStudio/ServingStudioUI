import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme';
import App from './App';
import { AnalyzerRepositoryProvider } from './application/RepositoryProvider';
import { ActiveRunProvider } from './application/ActiveRunProvider';
import { configuredAnalyzerRepository } from './repositories/configuredAnalyzerRepository';

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
      <AnalyzerRepositoryProvider repository={configuredAnalyzerRepository}>
        <ActiveRunProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
          </ThemeProvider>
        </ActiveRunProvider>
      </AnalyzerRepositoryProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
