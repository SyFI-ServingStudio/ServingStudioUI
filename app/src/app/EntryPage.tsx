import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

import type { CatalogFilter, Navigate } from '../location';
import { listWorkspaces } from '../session/api';
import type { WorkspaceCatalog } from '../session/types';
import ThemePicker from '../ui/controls/ThemePicker';
import { tokens, withAlpha } from '../ui/theme';
import { pageLayout } from '../ui/theme/metrics';
import { CatalogPage } from '../panels/catalog/CatalogPage';
import ConversationCatalog from '../panels/catalog/ConversationCatalog';
import AgentStart from './AgentStart';

type EntryMode = 'experiments' | 'new-conversation' | 'resume-conversation';

function ModeSwitch({ mode, onChange }: { mode: EntryMode; onChange: (mode: EntryMode) => void }) {
  return (
    <Stack
      role="tablist"
      aria-label="Workspace start mode"
      direction="row"
      sx={{ width: '100%', gap: { xs: 0, sm: 2 }, borderBottom: `1px solid ${tokens.hair}` }}
    >
      {(
        [
          ['experiments', 'Explore results'],
          ['new-conversation', 'New conversation'],
          ['resume-conversation', 'Resume conversation'],
        ] as const
      ).map(([value, label]) => (
        <ButtonBase
          key={value}
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          sx={{
            px: { xs: 0.75, sm: 1.5 },
            py: 1.8,
            minWidth: 0,
            flex: { xs: 1, sm: 'none' },
            borderBottom: `2px solid ${mode === value ? tokens.teal : 'transparent'}`,
            color: mode === value ? tokens.teal : tokens.sub,
            fontSize: { xs: 12, sm: 15 },
            fontWeight: 500,
            transition: `background 180ms ${tokens.ease}, color 180ms ${tokens.ease}`,
            '&:hover': { background: withAlpha(tokens.teal, 0.045) },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          {label}
        </ButtonBase>
      ))}
    </Stack>
  );
}

export default function EntryPage({
  filter,
  navigate,
}: {
  filter: CatalogFilter;
  navigate: Navigate;
}) {
  const [mode, setMode] = useState<EntryMode>('experiments');
  const [catalog, setCatalog] = useState<WorkspaceCatalog>({ workspaces: [], kinds: null });
  useEffect(() => {
    document.title = 'ServingStudio UI';
    const abort = new AbortController();
    void listWorkspaces(abort.signal)
      .then(setCatalog)
      .catch(() => setCatalog({ workspaces: [], kinds: null }));
    return () => abort.abort();
  }, []);
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        px: 0,
        py: { xs: 2, md: 3.5 },
        ...pageLayout,
        mx: 'auto',
        display: 'grid',
        gridTemplateRows: 'auto minmax(0,1fr) auto',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" alignItems="center" sx={{ gap: 1 }}>
          <Box
            component="img"
            src="./servingstudio-symbol.svg"
            alt=""
            sx={{ width: 34, height: 30, objectFit: 'contain' }}
          />
          <Typography
            sx={{ color: tokens.ink, fontWeight: 500, fontSize: 25, letterSpacing: '-.06em' }}
          >
            ServingStudio UI
          </Typography>
        </Stack>
        {mode !== 'new-conversation' && <ThemePicker />}
      </Stack>
      <Box sx={{ width: '100%', minWidth: 0, mx: 'auto', pt: 2.5, pb: 4 }}>
        <ModeSwitch mode={mode} onChange={setMode} />
        <Box
          key={mode}
          sx={{
            mt: { xs: 3, md: 5 },
            '@keyframes entryModeIn': {
              from: { opacity: 0, transform: 'translateY(8px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation: `entryModeIn 360ms ${tokens.ease} both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {mode === 'experiments' ? (
            <CatalogPage filter={filter} navigate={navigate} workspaces={catalog.workspaces} />
          ) : mode === 'new-conversation' ? (
            <AgentStart workspaces={catalog.workspaces} kinds={catalog.kinds} navigate={navigate} />
          ) : (
            <ConversationCatalog
              workspaces={catalog.workspaces}
              onActivate={(conversation) =>
                navigate(
                  {
                    view: 'chat',
                    chat: {
                      state: 'created',
                      workspace: conversation.workspaceId,
                      id: conversation.id,
                    },
                  },
                  'push',
                )
              }
            />
          )}
        </Box>
      </Box>
      <Stack direction="row" justifyContent="space-between" sx={{ color: tokens.sub2 }}>
        <Typography sx={{ fontSize: 12 }}>ServingStudio UI · Performance analysis</Typography>
        <Typography sx={{ fontSize: 12 }}>Simulate. Inspect. Compare.</Typography>
      </Stack>
    </Box>
  );
}
