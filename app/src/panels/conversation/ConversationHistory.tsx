import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { useMemo, useState } from 'react';

import { colors, tokens, withAlpha } from '../../ui/theme';
import type { AgentConversationSummary } from './agentTypes';
import { conversationTimeLabel } from './conversationPresentation';

export default function ConversationHistory({
  open,
  expanded,
  canPersist,
  persistent,
  conversations,
  currentId,
  loading,
  error,
  deletionDisabled,
  onClose,
  onTogglePersistent,
  onNew,
  onSelect,
  onDelete,
}: {
  open: boolean;
  expanded: boolean;
  canPersist: boolean;
  persistent: boolean;
  conversations: readonly AgentConversationSummary[];
  currentId: string | null;
  loading: boolean;
  error: string | null;
  deletionDisabled: boolean;
  onClose: () => void;
  onTogglePersistent: () => void;
  onNew: () => Promise<void>;
  onSelect: (conversationId: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleConversations = useMemo(
    () =>
      normalizedQuery
        ? conversations.filter((conversation) =>
            (conversation.title || 'New conversation')
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          )
        : conversations,
    [conversations, normalizedQuery],
  );
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
              {conversations.length} saved
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
          ) : visibleConversations.length === 0 ? (
            <Box sx={{ px: 1, py: 2.5 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 650 }}>
                {conversations.length === 0 ? 'No conversations yet' : 'No matching conversations'}
              </Typography>
              <Typography sx={{ mt: 0.35, color: tokens.sub2, fontSize: 12, lineHeight: 1.45 }}>
                {conversations.length === 0
                  ? 'Start a new conversation to keep its work and results here.'
                  : 'Try a shorter title search.'}
              </Typography>
            </Box>
          ) : (
            <Stack sx={{ gap: 0.35 }}>
              {visibleConversations.map((conversation) => {
                const active = conversation.id === currentId;
                const confirmingDelete = pendingDelete === conversation.id;
                return (
                  <Stack
                    key={conversation.id}
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
                      '&:focus-within .conversation-delete': { opacity: 1 },
                    }}
                  >
                    <ButtonBase
                      onClick={() => {
                        if (active) {
                          onClose();
                          return;
                        }
                        void onSelect(conversation.id).then(onClose);
                      }}
                      aria-current={active ? 'page' : undefined}
                      aria-label={`${active ? 'Current' : 'Open'} ${
                        conversation.title || 'conversation'
                      }`}
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
                          sx={{
                            color: active ? tokens.ink : tokens.sub,
                            fontSize: 12,
                            fontWeight: active ? 700 : 540,
                          }}
                        >
                          {conversation.title || 'New conversation'}
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
                    {confirmingDelete ? (
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
                      <ButtonBase
                        className="conversation-delete"
                        onClick={() => setPendingDelete(conversation.id)}
                        disabled={deletionDisabled}
                        aria-label={`Delete ${conversation.title || 'conversation'}`}
                        sx={{
                          mr: 0.45,
                          width: 28,
                          height: 28,
                          flex: '0 0 auto',
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
                );
              })}
            </Stack>
          )}
        </Box>
      </Box>
    </>
  );
}
