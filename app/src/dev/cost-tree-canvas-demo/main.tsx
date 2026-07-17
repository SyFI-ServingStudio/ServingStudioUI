import { CssBaseline, ThemeProvider } from '@mui/material';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { theme } from '../../theme';
import CostTreeCanvasDemo from './CostTreeCanvasDemo';

const root = document.getElementById('root');
if (root === null) throw new Error('CostTree canvas demo root is missing.');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <CostTreeCanvasDemo />
    </ThemeProvider>
  </StrictMode>,
);
