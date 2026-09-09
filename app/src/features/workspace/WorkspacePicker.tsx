import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import type { WorkspaceSummary } from '../../application/workspaceRepository';
import { tokens, withAlpha } from '../../theme';
import CatalogTag from './CatalogTag';
import { conversationTimeLabel } from './conversationPresentation';

export default function WorkspacePicker({
  workspaces,
  selectedWorkspaceId,
  onSelect,
}: {
  workspaces: readonly WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  onSelect: (workspaceId: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...workspaces]
      .filter(
        (workspace) =>
          !query ||
          workspace.displayName.toLocaleLowerCase().includes(query) ||
          workspace.workspaceId.toLocaleLowerCase().includes(query),
      )
      .sort(
        (left, right) =>
          right.lastAccessedAt - left.lastAccessedAt ||
          left.displayName.localeCompare(right.displayName),
      );
  }, [search, workspaces]);
  const columns = { xs: 'minmax(0,1fr) auto', md: 'minmax(0,1fr) 120px 82px' };
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      <Stack direction="row" alignItems="end" justifyContent="space-between" sx={{ mb: 0.8 }}>
        <Box>
          <Typography
            sx={{
              color: tokens.sub2,
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            Workspace for this conversation
          </Typography>
          <Typography sx={{ mt: 0.25, color: tokens.sub, fontSize: 12 }}>
            Reuse its files and logs, or begin in a clean workspace.
          </Typography>
        </Box>
        <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
          {visible.length}/{workspaces.length}
        </Typography>
      </Stack>
      <Stack
        direction="row"
        alignItems="center"
        sx={{
          px: 1.1,
          borderTop: `1.5px solid ${tokens.ink}`,
          borderBottom: `1px solid ${tokens.hair}`,
          background: withAlpha(tokens.tile, 0.45),
        }}
      >
        <SearchRounded aria-hidden sx={{ mr: 0.8, color: tokens.sub2, fontSize: 15 }} />
        <Box
          component="input"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search workspaces"
          placeholder="Find a workspace by name"
          sx={{
            width: '100%',
            height: 38,
            border: 0,
            outline: 0,
            background: 'transparent',
            color: tokens.ink,
            fontSize: 12,
            '&::placeholder': { color: tokens.sub2 },
          }}
        />
      </Stack>
      <Box
        role="listbox"
        aria-label="Workspace for new conversation"
        sx={{
          maxHeight: 184,
          overflowY: 'auto',
          borderBottom: `1px solid ${tokens.hair}`,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        {!search.trim() && (
          <ButtonBase
            role="option"
            aria-label="Create a new workspace"
            aria-selected={selectedWorkspaceId === null}
            onClick={() => onSelect(null)}
            sx={{
              width: '100%',
              minHeight: 43,
              px: 1.35,
              display: 'grid',
              gridTemplateColumns: columns,
              alignItems: 'center',
              gap: 1.2,
              borderBottom: `1px solid ${tokens.hair}`,
              background:
                selectedWorkspaceId === null ? withAlpha(tokens.teal, 0.065) : 'transparent',
              textAlign: 'left',
              '&:hover': { background: withAlpha(tokens.teal, 0.045) },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 650 }}>
                Create a new workspace
              </Typography>
              <Typography sx={{ color: tokens.sub2, fontSize: 12 }}>
                Isolated repo, logs, and conversation history
              </Typography>
            </Box>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <CatalogTag tone="axis" selected={selectedWorkspaceId === null}>
                new
              </CatalogTag>
            </Box>
            <Typography
              sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12, textAlign: 'right' }}
            >
              recommended
            </Typography>
          </ButtonBase>
        )}
        {visible.map((workspace) => {
          const selected = workspace.workspaceId === selectedWorkspaceId;
          return (
            <ButtonBase
              key={workspace.workspaceId}
              role="option"
              aria-label={`Select ${workspace.displayName}`}
              aria-selected={selected}
              onClick={() => onSelect(workspace.workspaceId)}
              sx={{
                width: '100%',
                minHeight: 43,
                px: 1.35,
                display: 'grid',
                gridTemplateColumns: columns,
                alignItems: 'center',
                gap: 1.2,
                borderBottom: `1px solid ${tokens.hair}`,
                background: selected ? withAlpha(tokens.teal, 0.065) : 'transparent',
                color: selected ? tokens.teal : tokens.sub,
                textAlign: 'left',
                '&:hover': { background: withAlpha(tokens.teal, 0.045), color: tokens.ink },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
              }}
            >
              <Typography noWrap sx={{ color: 'inherit', fontSize: 12, fontWeight: 620 }}>
                {workspace.displayName}
              </Typography>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <CatalogTag tone="workspace" selected={selected}>
                  {workspace.storageKind === 'external' ? 'development' : 'managed'}
                </CatalogTag>
              </Box>
              <Typography
                sx={{
                  color: tokens.sub2,
                  fontFamily: tokens.body,
                  fontSize: 12,
                  textAlign: 'right',
                }}
              >
                {conversationTimeLabel(workspace.lastAccessedAt)}
              </Typography>
            </ButtonBase>
          );
        })}
        {visible.length === 0 && (
          <Typography role="status" sx={{ px: 1.35, py: 2, color: tokens.sub2, fontSize: 12 }}>
            No workspace matches this search.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
