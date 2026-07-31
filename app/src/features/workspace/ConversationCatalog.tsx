import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';

import {
  listAllConversations,
  type WorkspaceConversationSummary,
} from '../../application/conversationRepository';
import type { WorkspaceSummary } from '../../application/workspaceRepository';
import { tokens } from '../../theme';
import CatalogColumnFilter from './CatalogColumnFilter';
import CatalogTag from './CatalogTag';
import { conversationTimeLabel } from './conversationPresentation';

function timestamp(updatedAt: WorkspaceConversationSummary['updated_at']): number {
  if (typeof updatedAt === 'number') {
    return updatedAt < 1_000_000_000_000 ? updatedAt * 1000 : updatedAt;
  }
  const parsed = Date.parse(String(updatedAt ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateKey(conversation: WorkspaceConversationSummary): string {
  const value = timestamp(conversation.updated_at);
  if (!value) return 'unknown';
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(conversation: WorkspaceConversationSummary): string {
  const value = timestamp(conversation.updated_at);
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ConversationCatalog({
  workspaces,
  onActivate,
}: {
  workspaces: readonly WorkspaceSummary[];
  onActivate: (conversation: WorkspaceConversationSummary) => void;
}) {
  const [conversations, setConversations] = useState<readonly WorkspaceConversationSummary[]>([]);
  const [search, setSearch] = useState('');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.workspaceId, workspace.displayName])),
    [workspaces],
  );
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);
    void listAllConversations()
      .then((items) => {
        if (!disposed) setConversations(items);
      })
      .catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : 'History failed');
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);
  const workspaceOptions = useMemo(
    () =>
      Array.from(new Set(conversations.map((conversation) => conversation.workspaceId))).sort(
        (left, right) =>
          (workspaceNames.get(left) ?? left).localeCompare(workspaceNames.get(right) ?? right),
      ),
    [conversations, workspaceNames],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...conversations]
      .filter((conversation) => {
        const workspaceName =
          workspaceNames.get(conversation.workspaceId) ?? conversation.workspaceId;
        return (
          (selectedWorkspaceIds.length === 0 ||
            selectedWorkspaceIds.includes(conversation.workspaceId)) &&
          (!query ||
            conversation.title.toLocaleLowerCase().includes(query) ||
            workspaceName.toLocaleLowerCase().includes(query))
        );
      })
      .sort(
        (left, right) =>
          timestamp(right.updated_at) - timestamp(left.updated_at) ||
          left.id.localeCompare(right.id),
      );
  }, [conversations, search, selectedWorkspaceIds, workspaceNames]);
  const toggleWorkspace = (workspaceId: string) =>
    setSelectedWorkspaceIds((current) =>
      current.includes(workspaceId)
        ? current.filter((candidate) => candidate !== workspaceId)
        : [...current, workspaceId],
    );
  const columns = {
    xs: 'minmax(0,1fr) 28px',
    md: '116px minmax(240px,1fr) minmax(170px,.72fr) 74px 28px',
  };
  return (
    <Box>
      <Box sx={{ maxWidth: 700, mx: 'auto', mb: 4, textAlign: 'center' }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontSize: 'clamp(40px,5.5vw,68px)',
            fontWeight: 600,
            letterSpacing: '-.035em',
            lineHeight: 1,
          }}
        >
          Return to the{' '}
          <Box component="em" sx={{ color: tokens.teal, fontWeight: 500 }}>
            thread.
          </Box>
        </Typography>
        <Typography sx={{ maxWidth: 560, mx: 'auto', mt: 1.8, color: tokens.sub, fontSize: 14.5 }}>
          Conversations are ordered by their latest activity, across every active workspace.
        </Typography>
      </Box>
      <Box sx={{ borderTop: `1.5px solid ${tokens.ink}` }}>
        <Box
          sx={{
            minHeight: 47,
            px: { xs: 1.4, md: 1.75 },
            display: 'grid',
            gridTemplateColumns: columns,
            alignItems: 'center',
            gap: 1.5,
            borderBottom: `1px solid ${tokens.hair}`,
          }}
        >
          <Typography
            sx={{
              display: { xs: 'none', md: 'block' },
              color: tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 8.5,
            }}
          >
            Last active
          </Typography>
          <Stack direction="row" alignItems="center" sx={{ minWidth: 0, gap: 1 }}>
            <Typography sx={{ color: tokens.sub, fontFamily: tokens.mono, fontSize: 8.5 }}>
              Conversation
            </Typography>
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8 }}>
              {visible.length} shown
            </Typography>
          </Stack>
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <CatalogColumnFilter
              label="Workspace"
              options={workspaceOptions}
              selected={selectedWorkspaceIds}
              onToggle={toggleWorkspace}
              onClear={() => setSelectedWorkspaceIds([])}
              optionLabel={(workspaceId) => workspaceNames.get(workspaceId) ?? workspaceId}
              tone="workspace"
            />
          </Box>
          <Typography
            sx={{
              display: { xs: 'none', md: 'block' },
              color: tokens.sub,
              fontFamily: tokens.mono,
              fontSize: 8.5,
            }}
          >
            Time
          </Typography>
          <Box />
        </Box>
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            px: 1.5,
            borderBottom: `1px solid ${tokens.hair}`,
            background: 'rgba(250,247,240,.4)',
          }}
        >
          <SearchRounded aria-hidden sx={{ mr: 0.75, color: tokens.sub2, fontSize: 15 }} />
          <Box
            component="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search conversations"
            placeholder="Find by conversation or workspace"
            sx={{
              width: '100%',
              height: 38,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: tokens.ink,
              fontSize: 10.5,
              '&::placeholder': { color: tokens.sub2 },
            }}
          />
          <Box sx={{ display: { xs: 'block', md: 'none' }, flex: '0 0 auto' }}>
            <CatalogColumnFilter
              label="Workspace"
              options={workspaceOptions}
              selected={selectedWorkspaceIds}
              onToggle={toggleWorkspace}
              onClear={() => setSelectedWorkspaceIds([])}
              optionLabel={(workspaceId) => workspaceNames.get(workspaceId) ?? workspaceId}
              tone="workspace"
            />
          </Box>
        </Stack>
        <Box
          role="list"
          aria-label="Conversations, newest first"
          sx={{
            maxHeight: 426,
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: `${tokens.hair} transparent`,
          }}
        >
          {loading ? (
            <Stack sx={{ p: 1.2, gap: 0.8 }}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} variant="rounded" height={43} />
              ))}
            </Stack>
          ) : error ? (
            <Typography
              role="alert"
              sx={{ px: 2, py: 3, color: tokens.terra, textAlign: 'center' }}
            >
              {error}
            </Typography>
          ) : visible.length === 0 ? (
            <Typography role="status" sx={{ px: 2, py: 3, color: tokens.sub, textAlign: 'center' }}>
              No conversations match this search.
            </Typography>
          ) : (
            visible.map((conversation, index) => {
              const previous = visible[index - 1];
              const showDate =
                previous === undefined || dateKey(previous) !== dateKey(conversation);
              const workspaceName =
                workspaceNames.get(conversation.workspaceId) ?? conversation.workspaceId;
              return (
                <ButtonBase
                  key={`${conversation.workspaceId}:${conversation.id}`}
                  role="listitem"
                  aria-label={`Resume ${conversation.title} in ${workspaceName}`}
                  onClick={() => onActivate(conversation)}
                  sx={{
                    width: '100%',
                    minHeight: 48,
                    px: { xs: 1.4, md: 1.75 },
                    display: 'grid',
                    gridTemplateColumns: columns,
                    alignItems: 'center',
                    gap: 1.5,
                    borderBottom: `1px solid ${tokens.hair}`,
                    color: tokens.sub,
                    textAlign: 'left',
                    transition: `background 180ms ${tokens.ease}, color 180ms ${tokens.ease}`,
                    '&:hover': { background: 'rgba(31,111,107,.045)', color: tokens.ink },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: -2 },
                  }}
                >
                  <Typography
                    aria-hidden={!showDate}
                    sx={{
                      display: { xs: 'none', md: 'block' },
                      color: showDate ? tokens.ink : 'transparent',
                      fontFamily: tokens.mono,
                      fontSize: 8.5,
                    }}
                  >
                    {showDate ? dateLabel(conversation) : '—'}
                  </Typography>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ color: 'inherit', fontSize: 11.5, fontWeight: 630 }}>
                      {conversation.title || 'New conversation'}
                    </Typography>
                    <Typography
                      sx={{
                        display: { xs: 'block', md: 'none' },
                        mt: 0.25,
                        color: tokens.sub2,
                        fontFamily: tokens.mono,
                        fontSize: 8,
                      }}
                    >
                      {workspaceName} · {conversationTimeLabel(conversation.updated_at)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}>
                    <CatalogTag tone="workspace">{workspaceName}</CatalogTag>
                  </Box>
                  <Typography
                    sx={{
                      display: { xs: 'none', md: 'block' },
                      color: tokens.sub2,
                      fontFamily: tokens.mono,
                      fontSize: 8,
                    }}
                  >
                    {conversationTimeLabel(conversation.updated_at)}
                  </Typography>
                  <ChevronRightRounded sx={{ color: tokens.sub2, fontSize: 15 }} />
                </ButtonBase>
              );
            })
          )}
        </Box>
      </Box>
    </Box>
  );
}
