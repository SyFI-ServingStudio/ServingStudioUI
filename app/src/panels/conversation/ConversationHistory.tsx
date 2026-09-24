import AddRounded from '@mui/icons-material/AddRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useCallback, useMemo, useRef, useState } from 'react';

import { colors, tokens, withAlpha } from '../../ui/theme';
import type { AgentConversationSummary, AgentWorkspaceConversations } from './agentTypes';
import { conversationTimeLabel } from './conversationPresentation';

interface HistoryGroup extends AgentWorkspaceConversations {
  /** The workspace on screen: its rows can be the active one and can be deleted. */
  readonly current: boolean;
}

function updatedMillis(conversation: AgentConversationSummary): number {
  const value = conversation.updated_at;
  if (value == null || value === '') return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric)) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestUpdate(group: AgentWorkspaceConversations): number {
  return Math.max(0, ...group.conversations.map(updatedMillis));
}

export default function ConversationHistory({
  open,
  expanded,
  canPersist,
  persistent,
  workspaceId,
  workspaceName,
  conversations,
  otherWorkspaces,
  currentId,
  loading,
  error,
  deletionDisabled,
  onClose,
  onTogglePersistent,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  open: boolean;
  expanded: boolean;
  canPersist: boolean;
  persistent: boolean;
  workspaceId: string;
  workspaceName?: string;
  conversations: readonly AgentConversationSummary[];
  otherWorkspaces: readonly AgentWorkspaceConversations[];
  currentId: string | null;
  loading: boolean;
  error: string | null;
  deletionDisabled: boolean;
  onClose: () => void;
  onTogglePersistent: () => void;
  onNew: () => Promise<void>;
  /** `workspace` is omitted for the workspace on screen. */
  onSelect: (conversationId: string, workspace?: string) => Promise<void>;
  onRename: (conversationId: string, workspace: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; title: string } | null>(null);
  // Which row's edit is still open. Enter, Escape and blur can all arrive for
  // one edit — removing a focused field blurs it — and only the first may act.
  const openEdit = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // Stable, so the field is focused once when it opens and not on every keystroke.
  const focusRenameInput = useCallback((node: HTMLInputElement | null) => node?.focus(), []);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const groups = useMemo<readonly HistoryGroup[]>(
    () => [
      { id: workspaceId, label: workspaceName ?? workspaceId, conversations, current: true },
      ...[...otherWorkspaces]
        .sort((left, right) => latestUpdate(right) - latestUpdate(left))
        .map((group) => ({ ...group, current: false })),
    ],
    [conversations, otherWorkspaces, workspaceId, workspaceName],
  );
  // Headings only earn their space once there is more than one workspace to tell apart.
  const grouped = groups.length > 1;
  const savedCount = groups.reduce((total, group) => total + group.conversations.length, 0);
  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => {
          if (!normalizedQuery) return group;
          const workspaceMatches = group.label.toLocaleLowerCase().includes(normalizedQuery);
          return {
            ...group,
            conversations: workspaceMatches
              ? group.conversations
              : group.conversations.filter((conversation) =>
                  (conversation.title || 'New conversation')
                    .toLocaleLowerCase()
                    .includes(normalizedQuery),
                ),
          };
        })
        .filter((group) => group.conversations.length > 0 || (group.current && !normalizedQuery)),
    [groups, normalizedQuery],
  );
  const visibleCount = visibleGroups.reduce(
    (total, group) => total + group.conversations.length,
    0,
  );
  // A search shows every match, so a folded workspace cannot hide one.
  const groupCollapsed = (id: string) => !normalizedQuery && collapsed.has(id);
  const toggleGroup = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const startRename = (key: string, title: string) => {
    openEdit.current = key;
    setEditing({ key, title });
  };
  const finishRename = (
    key: string,
    save: { conversation: AgentConversationSummary; workspace: string; title: string } | null,
  ) => {
    if (openEdit.current !== key) return;
    openEdit.current = null;
    setEditing(null);
    const title = save?.title.trim();
    if (save && title && title !== save.conversation.title) {
      void onRename(save.conversation.id, save.workspace, title);
    }
  };

  const renderRow = (conversation: AgentConversationSummary, group: HistoryGroup) => {
    const rowKey = `${group.id}/${conversation.id}`;
    const active = group.current && conversation.id === currentId;
    const confirmingDelete = group.current && pendingDelete === conversation.id;
    const renaming = editing?.key === rowKey;
    const label = conversation.title || 'New conversation';
    return (
      <Stack
        key={rowKey}
        direction="row"
        alignItems="center"
        sx={{
          minHeight: 48,
          borderLeft: `2px solid ${active ? tokens.teal : 'transparent'}`,
          borderRadius: 0.65,
          background: active ? tokens.selected : 'transparent',
          '&:hover': {
            background: active ? tokens.selected : tokens.leafbg,
          },
          '&:hover .conversation-action, &:focus-within .conversation-action': { opacity: 1 },
        }}
      >
        {renaming ? (
          <Box
            component="input"
            ref={focusRenameInput}
            value={editing.title}
            onChange={(event) => setEditing({ key: rowKey, title: event.target.value })}
            onFocus={(event) => event.target.select()}
            onBlur={(event) =>
              finishRename(rowKey, {
                conversation,
                workspace: group.id,
                title: event.currentTarget.value,
              })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                finishRename(rowKey, {
                  conversation,
                  workspace: group.id,
                  title: event.currentTarget.value,
                });
              }
              if (event.key === 'Escape') finishRename(rowKey, null);
            }}
            aria-label={`Rename ${label}`}
            maxLength={200}
            sx={{
              flex: 1,
              minWidth: 0,
              mx: 0.6,
              px: 0.5,
              height: 30,
              border: `1px solid ${withAlpha(tokens.teal, 0.58)}`,
              borderRadius: 0.65,
              outline: 0,
              background: tokens.leafbg,
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 12,
            }}
          />
        ) : (
          <ButtonBase
            onClick={() => {
              if (active) {
                onClose();
                return;
              }
              void onSelect(conversation.id, group.current ? undefined : group.id).then(onClose);
            }}
            onDoubleClick={() => startRename(rowKey, label)}
            aria-current={active ? 'page' : undefined}
            aria-label={`${active ? 'Current' : 'Open'} ${conversation.title || 'conversation'}`}
            sx={{
              flex: 1,
              minWidth: 0,
              alignSelf: 'stretch',
              justifyContent: 'flex-start',
              px: 1,
              py: 0.7,
              borderRadius: 0,
              textAlign: 'left',
              '&:focus-visible': {
                outline: `2px solid ${tokens.teal}`,
                outlineOffset: -2,
              },
            }}
          >
            <Box sx={{ minWidth: 0, width: '100%' }}>
              <Typography
                noWrap
                title={label}
                sx={{
                  color: active ? tokens.ink : tokens.sub,
                  fontSize: 12,
                  fontWeight: active ? 700 : 540,
                }}
              >
                {label}
              </Typography>
              <Typography
                sx={{
                  mt: 0.1,
                  color: tokens.sub2,
                  fontFamily: tokens.body,
                  fontSize: 12,
                }}
              >
                {conversationTimeLabel(conversation.updated_at)}
              </Typography>
            </Box>
          </ButtonBase>
        )}
        {renaming ? null : confirmingDelete ? (
          <Stack direction="row" sx={{ pr: 0.45, gap: 0.25 }}>
            <ButtonBase
              onClick={() => setPendingDelete(null)}
              sx={{ px: 0.45, py: 0.35, color: tokens.sub2, fontSize: 12 }}
            >
              Cancel
            </ButtonBase>
            <ButtonBase
              onClick={() => {
                setPendingDelete(null);
                void onDelete(conversation.id);
              }}
              sx={{ px: 0.45, py: 0.35, color: tokens.terra, fontSize: 12 }}
            >
              Delete
            </ButtonBase>
          </Stack>
        ) : (
          <Stack direction="row" sx={{ mr: 0.45, flex: '0 0 auto' }}>
            <ButtonBase
              className="conversation-action"
              onClick={() => startRename(rowKey, label)}
              aria-label={`Rename ${conversation.title || 'conversation'}`}
              sx={{
                width: 28,
                height: 28,
                borderRadius: 0.65,
                color: tokens.sub2,
                opacity: active ? 0.72 : 0,
                '&:hover': { color: tokens.teal, background: withAlpha(tokens.teal, 0.06) },
                '&:focus-visible': {
                  opacity: 1,
                  outline: `2px solid ${tokens.teal}`,
                  outlineOffset: 1,
                },
              }}
            >
              <EditOutlined sx={{ fontSize: 14 }} />
            </ButtonBase>
            {/* Deletion stays with the workspace on screen, whose history it refreshes. */}
            {group.current && (
              <ButtonBase
                className="conversation-action"
                onClick={() => setPendingDelete(conversation.id)}
                disabled={deletionDisabled}
                aria-label={`Delete ${conversation.title || 'conversation'}`}
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: 0.65,
                  color: tokens.sub2,
                  opacity: active ? 0.72 : 0,
                  '&:hover': {
                    color: tokens.terra,
                    background: withAlpha(tokens.terra, 0.06),
                  },
                  '&:focus-visible': {
                    opacity: 1,
                    outline: `2px solid ${tokens.terra}`,
                    outlineOffset: 1,
                  },
                }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 15 }} />
              </ButtonBase>
            )}
          </Stack>
        )}
      </Stack>
    );
  };

  if (!open) return null;
  return (
    <>
      {!persistent && (
        <ButtonBase
          aria-label="Close conversation history"
          onClick={onClose}
          sx={{
            position: 'absolute',
            inset: '54px 0 0',
            zIndex: 4,
            borderRadius: 0,
            background: colors.scrim,
          }}
        />
      )}
      <Box
        component="section"
        aria-label="Conversation history"
        data-history-mode={persistent ? 'persistent' : 'overlay'}
        sx={{
          position: persistent ? 'relative' : 'absolute',
          top: persistent ? 'auto' : 54,
          bottom: persistent ? 'auto' : 0,
          left: persistent ? 'auto' : 0,
          zIndex: persistent ? 1 : 5,
          gridColumn: persistent ? 1 : 'auto',
          gridRow: persistent ? 2 : 'auto',
          width: persistent ? '100%' : expanded ? 304 : 'min(304px,calc(100% - 16px))',
          minWidth: 0,
          minHeight: 0,
          display: 'grid',
          gridTemplateRows: 'auto auto minmax(0,1fr)',
          borderRight: `1px solid ${tokens.hair}`,
          background: tokens.tile,
          boxShadow: persistent ? 'none' : colors.sidebarShadow,
          animation: persistent ? 'none' : 'historyEnter 180ms ease-out',
          '@keyframes historyEnter': {
            from: { opacity: 0, transform: 'translateX(-8px)' },
            to: { opacity: 1, transform: 'translateX(0)' },
          },
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          sx={{ minHeight: 54, px: 1.5, borderBottom: `1px solid ${tokens.hair}` }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 12.5, fontWeight: 700 }}>
              Conversations
            </Typography>
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
              {grouped ? `${savedCount} in ${groups.length} workspaces` : `${savedCount} saved`}
            </Typography>
          </Box>
          <ButtonBase
            onClick={() => void onNew()}
            aria-label="New conversation"
            sx={{
              ml: 'auto',
              height: 30,
              px: 1,
              gap: 0.45,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 0.8,
              color: tokens.teal,
              fontSize: 12,
              fontWeight: 700,
              '&:hover': { borderColor: tokens.teal, background: withAlpha(tokens.teal, 0.055) },
              '&:active': { transform: 'translateY(1px)' },
              '&.Mui-disabled': { color: tokens.sub2, opacity: 0.5 },
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            <AddRounded sx={{ fontSize: 15 }} />
            New
          </ButtonBase>
          {canPersist && (
            <ButtonBase
              onClick={onTogglePersistent}
              aria-label={
                persistent ? 'Unpin conversation history' : 'Pin conversation history to the left'
              }
              sx={{
                ml: 0.45,
                width: 30,
                height: 30,
                flex: '0 0 auto',
                border: `1px solid ${persistent ? withAlpha(tokens.teal, 0.42) : tokens.hair}`,
                borderRadius: 0.8,
                color: persistent ? tokens.teal : tokens.sub2,
                background: persistent ? withAlpha(tokens.teal, 0.055) : 'transparent',
                '&:hover': { borderColor: tokens.teal, color: tokens.teal },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <PushPinRounded
                sx={{
                  fontSize: 14,
                  transform: persistent ? 'rotate(0deg)' : 'rotate(35deg)',
                  transition: `transform 160ms ${tokens.ease}`,
                }}
              />
            </ButtonBase>
          )}
        </Stack>
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            mx: 1.25,
            my: 1,
            px: 0.85,
            minHeight: 34,
            gap: 0.65,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.8,
            background: tokens.leafbg,
            '&:focus-within': {
              borderColor: withAlpha(tokens.teal, 0.58),
              boxShadow: `0 0 0 2px ${withAlpha(tokens.teal, 0.08)}`,
            },
          }}
        >
          <SearchRounded sx={{ color: tokens.sub2, fontSize: 15 }} />
          <Box
            component="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search conversations"
            placeholder="Search conversations"
            sx={{
              width: '100%',
              minWidth: 0,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 12,
              '&::placeholder': { color: tokens.sub2, opacity: 1 },
            }}
          />
        </Stack>
        <Box
          component="nav"
          aria-label="Saved conversations"
          sx={{
            minHeight: 0,
            overflowY: 'auto',
            px: 0.9,
            pb: 1.25,
            scrollbarWidth: 'thin',
            scrollbarColor: `${tokens.hair} transparent`,
          }}
        >
          {loading ? (
            <Stack sx={{ gap: 0.8, px: 0.35 }}>
              {[0, 1, 2, 3].map((index) => (
                <Skeleton
                  key={index}
                  variant="rounded"
                  height={48}
                  sx={{ bgcolor: withAlpha(tokens.sub, 0.07), borderRadius: 0.8 }}
                />
              ))}
            </Stack>
          ) : error ? (
            <Typography role="alert" sx={{ px: 1, py: 1, color: tokens.terra, fontSize: 12 }}>
              {error}
            </Typography>
          ) : visibleCount === 0 && !grouped ? (
            <Box sx={{ px: 1, py: 2.5 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 650 }}>
                {savedCount === 0 ? 'No conversations yet' : 'No matching conversations'}
              </Typography>
              <Typography sx={{ mt: 0.35, color: tokens.sub2, fontSize: 12, lineHeight: 1.45 }}>
                {savedCount === 0
                  ? 'Start a new conversation to keep its work and results here.'
                  : 'Try a shorter title search.'}
              </Typography>
            </Box>
          ) : !grouped ? (
            <Stack sx={{ gap: 0.35 }}>
              {visibleGroups.flatMap((group) =>
                group.conversations.map((conversation) => renderRow(conversation, group)),
              )}
            </Stack>
          ) : visibleCount === 0 && normalizedQuery ? (
            <Typography sx={{ px: 1, py: 2.5, color: tokens.sub2, fontSize: 12 }}>
              No matching conversations or workspaces.
            </Typography>
          ) : (
            <Stack sx={{ gap: 0.25 }}>
              {visibleGroups.map((group) => (
                <Box component="section" key={group.id} aria-label={`Workspace ${group.label}`}>
                  <ButtonBase
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={!groupCollapsed(group.id)}
                    sx={{
                      width: '100%',
                      justifyContent: 'flex-start',
                      gap: 0.4,
                      mt: 0.5,
                      px: 0.5,
                      py: 0.55,
                      borderRadius: 0.65,
                      color: group.current ? tokens.ink : tokens.sub2,
                      textAlign: 'left',
                      '&:hover': { color: tokens.ink },
                      '&:focus-visible': {
                        outline: `2px solid ${tokens.teal}`,
                        outlineOffset: -2,
                      },
                    }}
                  >
                    <ChevronRightRounded
                      sx={{
                        flex: '0 0 auto',
                        fontSize: 15,
                        transform: groupCollapsed(group.id) ? 'none' : 'rotate(90deg)',
                        transition: `transform 160ms ${tokens.ease}`,
                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                      }}
                    />
                    <Typography
                      noWrap
                      title={group.label}
                      sx={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700 }}
                    >
                      {group.label}
                    </Typography>
                    <Typography sx={{ flex: '0 0 auto', color: tokens.sub2, fontSize: 11.5 }}>
                      {group.current ? 'current' : group.conversations.length}
                    </Typography>
                  </ButtonBase>
                  {groupCollapsed(group.id) ? null : group.conversations.length === 0 ? (
                    <Typography sx={{ px: 1, py: 0.6, color: tokens.sub2, fontSize: 12 }}>
                      No conversations yet
                    </Typography>
                  ) : (
                    <Stack sx={{ gap: 0.35 }}>
                      {group.conversations.map((conversation) => renderRow(conversation, group))}
                    </Stack>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      </Box>
    </>
  );
}
