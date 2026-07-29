import { Box } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';

import { listWorkspaces } from '../../application/workspaceRepository';
import { workspaceIdFromLocation } from '../../application/workspaceRoute';
import AgentPane from './AgentWorkspace';

export default function AgentPage() {
  const workspaceId = workspaceIdFromLocation();
  const [workspaceName, setWorkspaceName] = useState<string>();
  const prompt = window.sessionStorage.getItem('vibesim.entry.prompt') ?? '';
  const consumeInitialPrompt = useCallback(() => {
    window.sessionStorage.removeItem('vibesim.entry.prompt');
  }, []);
  useEffect(() => {
    document.title = 'VibeSim · Agent';
  }, []);
  useEffect(() => {
    let disposed = false;
    void listWorkspaces()
      .then((workspaces) => {
        if (!disposed) {
          setWorkspaceName(
            workspaces.find((workspace) => workspace.workspaceId === workspaceId)?.displayName,
          );
        }
      })
      .catch(() => {
        if (!disposed) setWorkspaceName(undefined);
      });
    return () => {
      disposed = true;
    };
  }, [workspaceId]);
  return (
    <Box component="main" sx={{ width: '100%', minHeight: '100dvh', height: '100dvh' }}>
      <AgentPane
        key={workspaceId}
        workspaceId={workspaceId}
        workspaceName={workspaceName}
        onWorkspaceNameChange={setWorkspaceName}
        full
        prompt={prompt}
        onInitialPromptStarted={consumeInitialPrompt}
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
