import { Box } from '@mui/material';
import { useEffect } from 'react';

import AgentPane from './AgentWorkspace';

export default function AgentPage() {
  const prompt =
    window.sessionStorage.getItem('vibesim.entry.prompt') ??
    'Find the best configuration in the latest simulation results.';
  useEffect(() => {
    document.title = 'VibeSim · Agent';
  }, []);
  return (
    <Box component="main" sx={{ width: '100%', minHeight: '100dvh', height: '100dvh' }}>
      <AgentPane
        full
        prompt={prompt}
        onClose={() => {
          const destination = new URL(window.location.href);
          destination.search = '';
          destination.hash = '#/';
          window.location.assign(destination);
        }}
      />
    </Box>
  );
}
