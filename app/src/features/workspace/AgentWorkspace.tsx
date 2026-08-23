import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AdjustRounded from '@mui/icons-material/AdjustRounded';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import HexagonOutlined from '@mui/icons-material/HexagonOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import NorthEastRounded from '@mui/icons-material/NorthEastRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import PushPinRounded from '@mui/icons-material/PushPinRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import TocRounded from '@mui/icons-material/TocRounded';
import { Box, ButtonBase, Skeleton, Stack, Typography, useMediaQuery } from '@mui/material';
import {
  type FormEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { analyzerSelectionFromVizState } from '../../application/analyzerSelection';
import {
  activeConversationId,
  forgetActiveConversation,
  forgetPendingCodexRuntime,
  pendingCodexRuntime,
  rememberActiveConversation,
} from '../../application/conversationSession';
import {
  cancelConversationTurn,
  createConversation,
  deleteConversation,
  getConversation,
  listCodexBackends,
  listConversations,
  resumeConversationTurn,
  sendConversationTurn,
  updateConversationRuntime,
  type AgentSettings,
  type CodexModelOption,
  type CodexRoleRuntime,
  type CodexRuntimeSelection,
  type Conversation,
  type ConversationMessage,
  type ConversationMessagePage,
  type ConversationSummary,
  type ConversationTurnEvent,
} from '../../application/conversationRepository';
import { getWorkspace } from '../../application/workspaceRepository';
import type { AnalyzerSelectionV2 } from '../../domain/analyzerSelection';
import type { AnalyzerTurnContextV2 } from '../../domain/citation';
import { analyzerEvidenceHref } from '../../domain/analyzerNavigation';
import MarkdownBody from '../../components/MarkdownBody';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import {
  agentSettingsFromConversation,
  rolesForAgentMode,
  savedAgentSettings,
  saveAgentSettings,
} from './agentMode';
import AgentModePicker, { WorkingStyleTag } from './AgentModePicker';
import CodexRuntimePicker, { CodexRuntimeTag } from './CodexRuntimePicker';
import { EMPTY_RUNTIME_SELECTION } from './codexRuntime';
import { conversationTimeLabel } from './conversationPresentation';
import {
  conversationCards,
  type ConversationCard,
  type ConversationRole,
} from './conversationTimeline';
import {
  LIVE_OUTLINE_BLOCK_ID,
  conversationOutline,
  managedResultLabel,
  managedResultStatus,
  outlineBlockId,
  outlineCardAnchorId,
  outlineNoteAnchorId,
  type OutlineEntry,
} from './conversationOutline';
import ConversationProgressRail from './ConversationProgressRail';
import {
  activeOutlineAnchor,
  outlineAnchorOnScreen,
  scrollToOutlineAnchor,
} from './outlineNavigation';

type RoleTone = 'orchestrator' | 'implementer' | 'assistant' | 'answer' | 'error';

const roleStyle: Record<RoleTone, { color: string; line: string; wash: string }> = {
  orchestrator: {
    color: tokens.gold,
    line: 'rgba(128,102,0,.3)',
    wash: 'rgba(128,102,0,.055)',
  },
  implementer: {
    color: tokens.teal,
    line: 'rgba(31,111,107,.3)',
    wash: 'rgba(31,111,107,.055)',
  },
  // Olive sits between the orchestrator's gold and the implementer's teal, and
  // never appears beside either: a conversation runs one cast or the other.
  assistant: {
    color: tokens.olive,
    line: 'rgba(86,106,46,.3)',
    wash: 'rgba(86,106,46,.055)',
  },
  answer: {
    color: tokens.terra,
    line: 'rgba(168,75,46,.3)',
    wash: 'rgba(168,75,46,.055)',
  },
  error: {
    color: '#9a4538',
    line: 'rgba(154,69,56,.32)',
    wash: 'rgba(154,69,56,.065)',
  },
};

const roleTitles: Record<ConversationRole, string> = {
  orchestrator: 'Orchestrator',
  implementer: 'Implementer',
  assistant: 'Assistant',
};

/** Narrow a role name off the wire; the backend labels its own Codex calls. */
function isConversationRole(role: string): role is ConversationRole {
  return role in roleTitles;
}

/** Hub for coordinating, wrench for building, and one solid for doing both. */
function roleIcon(role: ConversationRole) {
  if (role === 'implementer') return <BuildOutlined sx={{ fontSize: 15 }} />;
  if (role === 'assistant') return <HexagonOutlined sx={{ fontSize: 15 }} />;
  return <HubOutlined sx={{ fontSize: 15 }} />;
}

// Both margins of the full-page reading room. Declared once so the grid track
// and the composer inset that keeps the reading column centred cannot drift.
const HISTORY_RAIL_WIDTH = 'clamp(232px,22vw,272px)';
const PROGRESS_RAIL_WIDTH = 'clamp(228px,20vw,288px)';

/**
 * Ring that marks where a progress-rail jump landed. Drawn outside the card so
 * it reads against the card's own wash, and gated on reduced motion by
 * `scrollToOutlineAnchor`, which chooses the attribute value.
 */
function outlineFlashSx(borderRadius: number) {
  return {
    borderRadius,
    '&[data-outline-flash="animated"]': {
      animation: `outlineFlash 900ms ${tokens.ease} both`,
    },
    '&[data-outline-flash="static"]': {
      boxShadow: `0 0 0 2px rgba(31,111,107,.45)`,
    },
    '@keyframes outlineFlash': {
      from: { boxShadow: '0 0 0 3px rgba(31,111,107,.3)' },
      to: { boxShadow: '0 0 0 3px rgba(31,111,107,0)' },
    },
  } as const;
}

function managedResultHref(
  workspaceId: string,
  jobKind: string,
  analyzerResourceId: string,
): string {
  const query = new URLSearchParams({ workspace: workspaceId });
  if (jobKind === 'timing_predict') {
    query.set('prediction', analyzerResourceId);
    query.set('optimalityMode', 'unlocked');
    return `#/prediction?${query.toString()}`;
  }
  if (jobKind === 'kernel_profile') {
    query.set('profile', analyzerResourceId);
    return `#/kernel-profile?${query.toString()}`;
  }
  query.set('measurement', analyzerResourceId);
  return `#/kernel-measurement?${query.toString()}`;
}

function RoleCard({
  tone,
  icon,
  title,
  round,
  runtime,
  status,
  children,
}: {
  tone: RoleTone;
  icon: ReactNode;
  title: string;
  round?: number;
  runtime?: CodexRoleRuntime;
  status: string;
  children: ReactNode;
}) {
  const style = roleStyle[tone];
  return (
    <Box
      sx={{
        p: 1.35,
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: style.wash,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.9 }}>
        <Box
          sx={{
            width: 27,
            height: 27,
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${style.line}`,
            borderRadius: 0.75,
            color: style.color,
            background: tokens.tile,
          }}
        >
          {icon}
        </Box>
        <Typography sx={{ color: tokens.ink, fontSize: 12.5, fontWeight: 700 }}>{title}</Typography>
        {round !== undefined && (
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 9 }}>
            round {round}
          </Typography>
        )}
        {runtime?.model && <CodexRuntimeTag model={runtime.model} effort={runtime.effort} />}
        <Typography
          sx={{
            ml: 'auto',
            color: style.color,
            fontFamily: tokens.mono,
            fontSize: 8.5,
            fontWeight: 600,
          }}
        >
          {status}
        </Typography>
      </Stack>
      <Box sx={{ mt: 1.1 }}>{children}</Box>
    </Box>
  );
}

function Note({
  children,
  workspaceId,
  level = 'progress',
  anchorId,
}: {
  children: ReactNode;
  workspaceId?: string;
  level?: 'progress' | 'milestone';
  /** Present on milestones, which the progress rail navigates to individually. */
  anchorId?: string;
}) {
  if (level === 'milestone') {
    return (
      <Stack
        direction="row"
        data-outline-anchor={anchorId}
        sx={{
          alignItems: 'flex-start',
          gap: 0.7,
          px: 0.85,
          py: 0.65,
          border: `1px solid ${tokens.teal}28`,
          background: `${tokens.teal}0A`,
          ...outlineFlashSx(1),
        }}
      >
        <CheckCircleOutlineRounded
          sx={{ mt: '2px', color: tokens.teal, fontSize: 13, flex: '0 0 auto' }}
        />
        {typeof children === 'string' ? (
          <MarkdownBody text={children} citations={[]} workspaceId={workspaceId} compact />
        ) : (
          <Typography sx={{ color: tokens.ink, fontSize: 11.5, lineHeight: 1.5 }}>
            {children}
          </Typography>
        )}
      </Stack>
    );
  }
  if (typeof children === 'string') {
    return <MarkdownBody text={children} citations={[]} workspaceId={workspaceId} compact />;
  }
  return (
    <Typography sx={{ color: tokens.sub, fontSize: 11.5, lineHeight: 1.5 }}>{children}</Typography>
  );
}

function ActivityLine({ text }: { text: string }) {
  const tool = text.match(/^tool:\s*(.+)$/i);
  const command = text.match(/^\$\s*(.+)$/);
  const label = command ? 'command' : 'tool call';
  const detail = tool?.[1] ?? command?.[1] ?? text;
  return (
    <Stack
      role="status"
      aria-label={`${label}: ${detail}`}
      direction="row"
      alignItems="center"
      sx={{
        gap: 0.75,
        minWidth: 0,
        color: tokens.teal,
        fontFamily: tokens.mono,
        fontSize: 9.5,
        lineHeight: 1.35,
      }}
    >
      <Stack direction="row" sx={{ gap: 0.3, flex: '0 0 auto' }} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: tokens.teal,
              animation: 'agentActivityPulse 1.2s ease-in-out infinite',
              animationDelay: `${index * 160}ms`,
              '@keyframes agentActivityPulse': {
                '0%, 70%, 100%': { opacity: 0.24, transform: 'translateY(0)' },
                '35%': { opacity: 0.9, transform: 'translateY(-1px)' },
              },
            }}
          />
        ))}
      </Stack>
      <Box
        component="span"
        sx={{
          flex: '0 0 auto',
          color: tokens.sub2,
          fontSize: 8,
          fontWeight: 650,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Box>
      <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {detail || 'working…'}
      </Box>
    </Stack>
  );
}

function FailureCard({ text, workspaceId }: { text: string; workspaceId?: string }) {
  return (
    <RoleCard
      tone="error"
      icon={<ErrorOutlineRounded sx={{ fontSize: 15 }} />}
      title="Agent unavailable"
      status="retry"
    >
      <Note workspaceId={workspaceId}>{text}</Note>
    </RoleCard>
  );
}

function Handoff({
  from,
  to,
  text,
  workspaceId,
}: {
  from: 'Orchestrator' | 'Implementer';
  to: 'Orchestrator' | 'Implementer';
  text: string;
  workspaceId: string;
}) {
  const isImplementationReport = from === 'Implementer';
  const style = roleStyle[isImplementationReport ? 'implementer' : 'orchestrator'];
  return (
    <Box
      component="section"
      aria-label={isImplementationReport ? 'Implementation report' : 'Delegated task'}
      sx={{
        p: 1.35,
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: style.wash,
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ gap: 0.85 }}>
        <Box
          sx={{
            width: 27,
            height: 27,
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            border: `1px solid ${style.line}`,
            borderRadius: 0.75,
            color: style.color,
            background: tokens.tile,
          }}
        >
          {isImplementationReport ? (
            <BuildOutlined sx={{ fontSize: 14 }} />
          ) : (
            <NorthEastRounded sx={{ fontSize: 14 }} />
          )}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 700 }}>
            {isImplementationReport ? 'Implementation report' : 'Delegated task'}
          </Typography>
          <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.25 }}>
            {from} to {to}
          </Typography>
        </Box>
      </Stack>
      <Box
        sx={{
          mt: 1,
          pt: 1,
          borderTop: `1px solid ${style.line}`,
          '& .agent-markdown > :first-of-type': { mt: 0 },
        }}
      >
        <MarkdownBody text={text} citations={[]} workspaceId={workspaceId} compact />
      </Box>
    </Box>
  );
}

function UserMessage({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        maxWidth: '82%',
        alignSelf: 'flex-end',
        px: 1.3,
        py: 1,
        border: `1px solid ${tokens.hair}`,
        borderRadius: '10px 10px 3px 10px',
        background: tokens.tile,
        color: tokens.ink,
        fontSize: 11.5,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}
    >
      {children}
    </Box>
  );
}

/**
 * A message typed while a turn was running, waiting for its own turn.
 *
 * It is deliberately client-only: nothing is sent until the queue actually
 * reaches it, so discarding one leaves no trace in the conversation. `context`
 * is snapshotted at enqueue time because the user wrote the message while
 * looking at that selection — by the time it is sent they may be somewhere
 * else, and re-reading the current selection would attach the wrong evidence.
 */
interface QueuedMessage {
  id: string;
  text: string;
  context: AnalyzerTurnContextV2 | null;
  /** Set by an interrupt: the queue stops draining until the user acts. */
  suspended: boolean;
}

/** Above this the strip crowds out the live timeline it is queued behind. */
const MAX_QUEUED_MESSAGES = 5;

/**
 * Ids for queued messages, from a counter rather than `crypto.randomUUID`.
 *
 * `randomUUID` exists only in a secure context, and this UI is routinely served
 * over plain http on a LAN address, where reaching for it throws on render.
 * The id never leaves the browser — it only tells two cards in one list apart —
 * so uniqueness within a page load is the whole requirement.
 */
let queuedMessageSequence = 0;

function nextQueuedMessageId(): string {
  queuedMessageSequence += 1;
  return `queued-${queuedMessageSequence}`;
}

function QueuedMessages({
  messages,
  onDiscard,
  onReturnToComposer,
}: {
  messages: readonly QueuedMessage[];
  onDiscard: (id: string) => void;
  onReturnToComposer: (id: string) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <Stack role="list" aria-label="Queued messages" sx={{ gap: 0.75 }}>
      {messages.map((message, index) => (
        <Stack
          key={message.id}
          role="listitem"
          aria-label={`Queued message ${index + 1} of ${messages.length}`}
          sx={{ alignSelf: 'flex-end', maxWidth: '82%', alignItems: 'flex-end', gap: 0.4 }}
        >
          <Stack direction="row" alignItems="center" sx={{ gap: 0.7 }}>
            <Typography
              sx={{
                color: message.suspended ? tokens.terra : tokens.sub2,
                fontFamily: tokens.mono,
                fontSize: 7.5,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
              }}
            >
              {message.suspended ? 'Suspended' : 'Queued'}
            </Typography>
            {message.context !== null && (
              <Typography
                sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 7.5 }}
                title="Carries the Analyzer selection from when it was queued"
              >
                · with selection
              </Typography>
            )}
            {message.suspended && (
              <ButtonBase
                onClick={() => onReturnToComposer(message.id)}
                sx={{
                  px: 0.5,
                  color: tokens.teal,
                  fontFamily: tokens.mono,
                  fontSize: 7.5,
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  '&:hover': { textDecoration: 'underline' },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                Return to composer
              </ButtonBase>
            )}
            <ButtonBase
              onClick={() => onDiscard(message.id)}
              aria-label={`Discard queued message ${index + 1}`}
              sx={{
                width: 14,
                height: 14,
                borderRadius: 0.4,
                color: tokens.sub2,
                '&:hover': { color: tokens.terra },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <CloseRounded sx={{ fontSize: 11 }} />
            </ButtonBase>
          </Stack>
          {/* Same geometry as a sent message, drawn unsent: dashed edge, paper
              rather than tile, dimmed ink. */}
          <Box
            sx={{
              px: 1.3,
              py: 1,
              border: `1px dashed ${message.suspended ? 'rgba(153,68,45,.4)' : tokens.hair}`,
              borderRadius: '10px 10px 3px 10px',
              background: tokens.leafbg,
              color: tokens.sub,
              fontSize: 11.5,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
            }}
          >
            {message.text}
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

const EAGER_TRANSCRIPT_MESSAGES = 4;
const EAGER_TIMELINE_CARDS = 3;

/**
 * Keeps distant conversation content out of the React tree entirely. The empty
 * block preserves approximate scroll geometry; once it approaches the viewport
 * it mounts once and stays mounted, so scrolling back never flashes or reparses
 * Markdown a second time.
 */
function LazyTranscriptBlock({
  children,
  eager = false,
  estimatedHeight,
  blockId,
  anchorId,
}: {
  children: ReactNode;
  eager?: boolean;
  estimatedHeight: number;
  /**
   * Progress-rail handle that survives unmounting. The placeholder keeps the
   * approximate position, so jumping to it is what brings the real content
   * within this observer's margin and mounts it.
   */
  blockId?: string;
  /** Set when the block's content is itself an indexed rail entry. */
  anchorId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(
    () => eager || typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (mounted) return;
    if (eager || typeof IntersectionObserver === 'undefined') {
      setMounted(true);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setMounted(true);
        observer.disconnect();
      },
      { rootMargin: '720px 0px' },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [eager, mounted]);

  return (
    <Box
      ref={containerRef}
      data-lazy-state={mounted ? 'mounted' : 'deferred'}
      data-outline-block={blockId}
      data-outline-anchor={anchorId}
      sx={{
        width: '100%',
        minWidth: 0,
        minHeight: mounted ? 0 : estimatedHeight,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.1,
        contentVisibility: mounted ? 'auto' : undefined,
        containIntrinsicSize: mounted ? `auto ${estimatedHeight}px` : undefined,
        ...(anchorId ? outlineFlashSx(1.2) : {}),
      }}
    >
      {mounted ? children : null}
    </Box>
  );
}

function cardEstimatedHeight(card: ConversationCard): number {
  if (card.type === 'job') return 66;
  const textLength =
    card.type === 'role'
      ? card.notes.reduce((total, note) => total + note.text.length, 0)
      : card.text.length;
  return Math.min(720, Math.max(82, 68 + Math.ceil(textLength / 72) * 17));
}

function messageEstimatedHeight(message: ConversationMessage): number {
  if (message.role === 'user') {
    return Math.min(220, Math.max(48, 34 + Math.ceil(message.content.length / 60) * 17));
  }
  const events = message.activity ?? [];
  const textLength = events.reduce((total, event) => {
    if ('text' in event && typeof event.text === 'string') return total + event.text.length;
    if ('task' in event && typeof event.task === 'string') return total + event.task.length;
    return total;
  }, message.content.length);
  return Math.min(1_600, Math.max(120, 72 + events.length * 22 + Math.ceil(textLength / 72) * 17));
}

const TimelineCardView = memo(function TimelineCardView({
  card,
  cardAnchorId,
  drivingRole,
  latest = false,
  message,
  streaming,
  toolCall,
  workspaceId,
}: {
  card: ConversationCard;
  /** Anchor of the enclosing block, used to address individual milestones. */
  cardAnchorId?: string;
  /** Whose voice asks for input in this turn — the orchestrator, or the assistant. */
  drivingRole: ConversationRole;
  /** Last card of the turn: the one the live activity line belongs to. */
  latest?: boolean;
  message?: ConversationMessage;
  streaming: boolean;
  toolCall: string;
  workspaceId: string;
}) {
  if (card.type === 'handoff') {
    return (
      <Handoff
        from={card.variant === 'delegated-task' ? 'Orchestrator' : 'Implementer'}
        to={card.variant === 'delegated-task' ? 'Implementer' : 'Orchestrator'}
        text={card.text}
        workspaceId={workspaceId}
      />
    );
  }
  if (card.type === 'role') {
    return (
      <RoleCard
        tone={card.role}
        icon={roleIcon(card.role)}
        title={roleTitles[card.role]}
        round={card.round}
        runtime={card.runtime}
        status={!card.done && streaming ? 'working' : 'done'}
      >
        <Stack sx={{ gap: 0.65 }}>
          {card.notes.map((note, noteIndex) => (
            <Note
              key={noteIndex}
              workspaceId={workspaceId}
              level={note.level}
              anchorId={
                cardAnchorId && note.level === 'milestone'
                  ? outlineNoteAnchorId(cardAnchorId, noteIndex)
                  : undefined
              }
            >
              {note.text}
            </Note>
          ))}
          {/* One line, on the newest card only: `toolCall` is a single live
              value, so drawing it in every open card repeats one action as
              several. */}
          {latest && !card.done && streaming && toolCall && <ActivityLine text={toolCall} />}
        </Stack>
      </RoleCard>
    );
  }
  if (card.type === 'job') {
    const status = managedResultStatus(card.status);
    const ready = status === 'ready';
    const failed = status === 'failed';
    const typedJob = Boolean(card.jobKind && card.resourceId);
    const jobLabel = managedResultLabel(card);
    const title = ready
      ? `${jobLabel} ready`
      : failed
        ? `${jobLabel} stopped`
        : `${jobLabel} running`;
    const destination = typedJob
      ? card.analyzerResourceId
        ? managedResultHref(card.workspaceId, card.jobKind ?? '', card.analyzerResourceId)
        : null
      : analyzerEvidenceHref({
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: card.workspaceId,
          experimentId: card.experimentId,
        });
    return (
      <ButtonBase
        disabled={!ready || (typedJob ? !card.analyzerResourceId : !card.experimentId)}
        onClick={() => {
          if (destination) window.location.hash = destination;
        }}
        sx={{
          width: '100%',
          p: 1.25,
          justifyContent: 'flex-start',
          border: `1px solid ${
            failed ? 'rgba(154,69,56,.3)' : ready ? 'rgba(31,111,107,.34)' : tokens.hair
          }`,
          borderLeft: `2px solid ${failed ? '#9a4538' : tokens.teal}`,
          borderRadius: 1.1,
          background: ready ? 'rgba(31,111,107,.055)' : 'rgba(91,82,71,.035)',
          textAlign: 'left',
          '&:hover': ready ? { background: 'rgba(31,111,107,.09)' } : undefined,
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ width: '100%', minWidth: 0, gap: 1 }}>
          {failed ? (
            <ErrorOutlineRounded sx={{ color: '#9a4538', fontSize: 16 }} />
          ) : card.jobKind === 'kernel_profile' || card.jobKind === 'kernel_measure' ? (
            <BuildOutlined sx={{ color: ready ? tokens.teal : tokens.gold, fontSize: 16 }} />
          ) : ready ? (
            <CheckCircleOutlineRounded sx={{ color: tokens.teal, fontSize: 16 }} />
          ) : (
            <AdjustRounded sx={{ color: tokens.gold, fontSize: 16 }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 11.5, fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
              {card.artifactPath || card.experimentPath}
            </Typography>
          </Box>
          {ready && <NorthEastRounded sx={{ ml: 'auto', color: tokens.teal, fontSize: 15 }} />}
        </Stack>
      </ButtonBase>
    );
  }
  if (card.type === 'error') {
    return <FailureCard text={card.text} workspaceId={workspaceId} />;
  }
  return (
    <RoleCard
      tone={card.outcome === 'request_user_input' ? drivingRole : 'answer'}
      icon={
        card.outcome === 'request_user_input' ? (
          <HelpOutlineRounded sx={{ fontSize: 15 }} />
        ) : (
          <CheckCircleOutlineRounded sx={{ fontSize: 15 }} />
        )
      }
      title={card.outcome === 'request_user_input' ? 'Input needed' : 'Answer'}
      status={card.outcome === 'request_user_input' ? 'waiting' : 'ready'}
    >
      <MarkdownBody
        text={card.text}
        citations={message?.citations ?? []}
        workspaceId={workspaceId}
      />
    </RoleCard>
  );
});

function AssistantTimeline({
  message,
  events,
  streaming,
  toolCall,
  workspaceId,
  blockId,
  expectedDrivingRole = 'orchestrator',
}: {
  message?: ConversationMessage;
  events: readonly ConversationTurnEvent[];
  streaming: boolean;
  toolCall: string;
  workspaceId: string;
  /** Turn-level progress-rail handle; each card derives its own from it. */
  blockId: string;
  /** Only consulted before the turn's first card arrives; then the turn tells us. */
  expectedDrivingRole?: ConversationRole;
}) {
  const cards = conversationCards(events);
  // A stored turn carries its own cast, so an old orchestrated transcript keeps
  // its colours no matter what the conversation runs today.
  const drivingRole =
    cards.find((card): card is Extract<ConversationCard, { type: 'role' }> => card.type === 'role')
      ?.role ?? expectedDrivingRole;
  if (message?.failure) {
    return <FailureCard text={message.failure.message} workspaceId={workspaceId} />;
  }
  if (streaming && cards.length === 0) {
    return (
      <RoleCard
        tone={expectedDrivingRole}
        icon={roleIcon(expectedDrivingRole)}
        title={roleTitles[expectedDrivingRole]}
        round={1}
        status="working"
      >
        <ActivityLine text={toolCall || 'Preparing the inquiry workspace…'} />
      </RoleCard>
    );
  }
  return cards.map((card, index) => {
    const cardAnchorId = outlineCardAnchorId(blockId, index);
    // Job and answer cards are rail entries in their own right; a role card is
    // only reachable through the individual milestones inside it.
    const indexed = card.type === 'job' || card.type === 'response';
    return (
      <LazyTranscriptBlock
        key={index}
        eager={index >= cards.length - EAGER_TIMELINE_CARDS}
        estimatedHeight={cardEstimatedHeight(card)}
        blockId={cardAnchorId}
        anchorId={indexed ? cardAnchorId : undefined}
      >
        <TimelineCardView
          card={card}
          cardAnchorId={cardAnchorId}
          drivingRole={drivingRole}
          latest={index === cards.length - 1}
          message={message}
          streaming={streaming}
          toolCall={toolCall}
          workspaceId={workspaceId}
        />
      </LazyTranscriptBlock>
    );
  });
}

const PersistedConversationMessage = memo(function PersistedConversationMessage({
  message,
  workspaceId,
  blockId,
}: {
  message: ConversationMessage;
  workspaceId: string;
  blockId: string;
}) {
  if (message.role === 'user') return <UserMessage>{message.content}</UserMessage>;
  return (
    <AssistantTimeline
      message={message}
      events={
        message.activity?.length ? message.activity : [{ kind: 'final', text: message.content }]
      }
      streaming={false}
      toolCall=""
      workspaceId={workspaceId}
      blockId={blockId}
    />
  );
});

/**
 * What an empty conversation shows instead of a transcript.
 *
 * The working style is pinned by the first message, so this is the only moment
 * it can be set — and the only moment the body is empty enough to hold it. It
 * used to sit in the composer's header, where it was both oversized for a band
 * above the input and present on every later turn that could no longer change
 * it.
 */
function ConversationOpening({
  agentSettings,
  disabled,
  onChange,
}: {
  agentSettings: AgentSettings;
  disabled: boolean;
  onChange: (settings: AgentSettings) => void;
}) {
  return (
    <Stack alignItems="center" sx={{ gap: 1.6, py: 2 }}>
      <Typography
        sx={{
          color: tokens.sub2,
          fontFamily: tokens.mono,
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: '.15em',
          textTransform: 'uppercase',
        }}
      >
        Working style
      </Typography>
      <AgentModePicker
        settings={agentSettings}
        locked={false}
        disabled={disabled}
        size="md"
        onChange={onChange}
      />
    </Stack>
  );
}

export const ConversationTranscript = memo(function ConversationTranscript({
  workspaceId,
  messages,
  messageStartIndex,
  liveEvents,
  toolCall,
  streaming,
  error,
  canLoadEarlier,
  loadingEarlier,
  onLoadEarlier,
  drivingRole,
  queued = [],
  onDiscardQueued = () => {},
  onReturnQueuedToComposer = () => {},
}: {
  workspaceId: string;
  messages: readonly ConversationMessage[];
  messageStartIndex: number;
  liveEvents: readonly ConversationTurnEvent[];
  toolCall: string;
  streaming: boolean;
  error: string | null;
  canLoadEarlier: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  /** The role this conversation's agent mode runs first, for the live turn. */
  drivingRole: ConversationRole;
  /** Optional so a transcript can be rendered without a live composer behind it. */
  queued?: readonly QueuedMessage[];
  onDiscardQueued?: (id: string) => void;
  onReturnQueuedToComposer?: (id: string) => void;
}) {
  return (
    <Stack sx={{ gap: 1.1 }}>
      {canLoadEarlier && (
        <ButtonBase
          onClick={onLoadEarlier}
          disabled={loadingEarlier || streaming}
          sx={{
            alignSelf: 'center',
            px: 1.1,
            py: 0.55,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 0.75,
            color: tokens.sub2,
            fontFamily: tokens.mono,
            fontSize: 8.5,
            '&:hover': { color: tokens.teal, borderColor: 'rgba(31,111,107,.35)' },
          }}
        >
          {loadingEarlier ? 'Loading earlier…' : 'Load earlier messages'}
        </ButtonBase>
      )}
      {messages.map((message, index) => {
        const blockId = outlineBlockId(messageStartIndex + index);
        return (
          <LazyTranscriptBlock
            key={messageStartIndex + index}
            eager={index >= messages.length - EAGER_TRANSCRIPT_MESSAGES}
            estimatedHeight={messageEstimatedHeight(message)}
            blockId={blockId}
          >
            <PersistedConversationMessage
              message={message}
              workspaceId={workspaceId}
              blockId={blockId}
            />
          </LazyTranscriptBlock>
        );
      })}
      {streaming && (
        <AssistantTimeline
          events={liveEvents}
          streaming
          toolCall={toolCall}
          workspaceId={workspaceId}
          blockId={LIVE_OUTLINE_BLOCK_ID}
          expectedDrivingRole={drivingRole}
        />
      )}
      {/* Below the live turn, because that is where they are in line. They stay
          after streaming ends only when an interrupt suspended them. */}
      <QueuedMessages
        messages={queued}
        onDiscard={onDiscardQueued}
        onReturnToComposer={onReturnQueuedToComposer}
      />
      {error && (
        <Typography
          role="alert"
          sx={{ color: tokens.terra, fontFamily: tokens.mono, fontSize: 9.5 }}
        >
          {error}
        </Typography>
      )}
    </Stack>
  );
});

function contextValues(selection: AnalyzerSelectionV2 | null): readonly string[] {
  if (selection === null) return [];
  if (selection.kind === 'aggregate') {
    return [
      'aggregate',
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey && selection.metricKey !== selection.panelId
        ? [selection.metricKey]
        : []),
      ...(selection.statistic ? [selection.statistic] : []),
      ...Object.entries(selection.coordinates ?? {}).map(
        ([axis, value]) => `${axis}=${Array.isArray(value) ? value.join('+') : String(value)}`,
      ),
    ];
  }
  if (selection.kind === 'prediction') {
    return [
      'prediction',
      selection.predictionId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.caseId ? [`case=${selection.caseId}`] : []),
      ...(selection.operationId ? [`operation=${selection.operationId}`] : []),
      ...(selection.leafId !== null ? [`kernel=${selection.leafId}`] : []),
      ...(selection.parallelId !== null ? [`parallel=${selection.parallelId}`] : []),
      `optimality=${selection.optimalityMode}`,
    ];
  }
  if (selection.kind === 'kernel_profile') {
    return [
      'kernel profile',
      selection.profileId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey ? [selection.metricKey] : []),
    ];
  }
  if (selection.kind === 'kernel_measurement') {
    return [
      'kernel measurement',
      selection.measurementId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey ? [selection.metricKey] : []),
      ...(selection.plotName ? [selection.plotName] : []),
    ];
  }
  return [
    'run',
    ...(selection.panelId ? [selection.panelId] : []),
    selection.scope,
    ...(selection.poolRole ? [`pool=${selection.poolRole}`] : []),
    ...(selection.workerKey ? [`worker=${selection.workerKey}`] : []),
    ...(selection.leafId !== null ? [`kernel=${selection.leafId}`] : []),
    ...(selection.parId !== null ? [`parallel=${selection.parId}`] : []),
  ];
}

function AnalyzerSelectionStrip({ onClear }: { onClear: () => void }) {
  const selection = useViz(analyzerSelectionFromVizState);
  const [expanded, setExpanded] = useState(false);
  const values = contextValues(selection);
  const identity = JSON.stringify(selection);
  return (
    <Box
      role="status"
      aria-label="Active Analyzer selection"
      aria-live="polite"
      sx={{
        mb: 1.15,
        px: 0.85,
        py: 0.7,
        border: `1px solid rgba(31,111,107,.22)`,
        borderRadius: 0.85,
        background: 'rgba(31,111,107,.045)',
      }}
    >
      <Stack direction="row" alignItems="center" useFlexGap sx={{ gap: 0.65 }}>
        <AdjustRounded sx={{ flex: '0 0 auto', color: tokens.teal, fontSize: 13 }} />
        <Typography
          sx={{
            flex: '0 0 auto',
            color: tokens.teal,
            fontFamily: tokens.mono,
            fontSize: 7.8,
            fontWeight: 650,
            letterSpacing: '.11em',
            textTransform: 'uppercase',
          }}
        >
          Selected
        </Typography>
        <Stack
          key={identity}
          direction="row"
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          sx={{
            minWidth: 0,
            gap: 0.4,
            '@keyframes selectionContextIn': {
              from: { opacity: 0.35, transform: 'translateY(2px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation: `selectionContextIn 320ms ${tokens.ease} both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {values.length === 0 ? (
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
              No Analyzer selection
            </Typography>
          ) : (
            values.map((value, index) => (
              <Box
                key={`${index}-${value}`}
                component="span"
                title={value}
                sx={{
                  maxWidth: 180,
                  px: 0.55,
                  py: 0.3,
                  overflow: 'hidden',
                  border: `1px solid ${index === 0 ? 'rgba(31,111,107,.25)' : tokens.hair}`,
                  borderRadius: 0.55,
                  background: index === 0 ? 'rgba(31,111,107,.08)' : tokens.tile,
                  color: index === 0 ? tokens.teal : tokens.sub,
                  fontFamily: tokens.mono,
                  fontSize: 8,
                  lineHeight: 1,
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </Box>
            ))
          )}
        </Stack>
        {selection && (
          <ButtonBase
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            sx={{
              ml: 'auto',
              flex: '0 0 auto',
              color: tokens.teal,
              fontFamily: tokens.mono,
              fontSize: 8,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {expanded ? 'hide JSON' : 'view JSON'}
          </ButtonBase>
        )}
        <ButtonBase
          onClick={onClear}
          aria-label="Clear Analyzer context"
          title="Do not include this selection in the next Agent turn"
          sx={{
            width: 20,
            height: 20,
            flex: '0 0 auto',
            borderRadius: 0.55,
            color: tokens.sub2,
            '&:hover': { background: 'rgba(31,111,107,.08)', color: tokens.teal },
            '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
          }}
        >
          <CloseRounded sx={{ fontSize: 13 }} />
        </ButtonBase>
      </Stack>
      {expanded && selection && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mt: 0.75,
            p: 0.8,
            maxHeight: 150,
            overflow: 'auto',
            borderTop: `1px solid ${tokens.hair}`,
            color: tokens.sub,
            fontFamily: tokens.mono,
            fontSize: 8,
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}
        >
          {JSON.stringify(selection, null, 2)}
        </Box>
      )}
    </Box>
  );
}

/**
 * Says where the next message goes after an interrupt.
 *
 * Read-only on purpose: the target is not a preference, it is wherever the
 * interrupt landed. Offering a switch would imply you can address a role whose
 * session has nothing to continue.
 */
/**
 * Who the next message reaches, while that is not the driving role.
 *
 * It stays up for as long as the side conversation lasts — the implementer
 * keeps answering, so a second question needs no second interrupt — which is
 * exactly why it needs a way out: without one, returning to the orchestrator
 * would mean saying something the implementer chooses to hand back.
 */
function ResumeTargetStrip({ role, onRelease }: { role: string; onRelease: () => void }) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      sx={{
        gap: 0.6,
        mb: 0.75,
        px: 0.9,
        py: 0.5,
        border: '1px solid rgba(31,111,107,.26)',
        borderRadius: 0.7,
        background: 'rgba(31,111,107,.045)',
      }}
    >
      <Box aria-hidden sx={{ width: 4, height: 4, borderRadius: '50%', background: tokens.teal }} />
      <Typography sx={{ color: tokens.teal, fontFamily: tokens.mono, fontSize: 8 }}>
        Next message continues with the {role}
      </Typography>
      <ButtonBase
        onClick={onRelease}
        aria-label="Send the next message to the orchestrator instead"
        sx={{
          ml: 'auto',
          px: 0.6,
          py: 0.15,
          borderRadius: 0.5,
          color: tokens.sub2,
          fontFamily: tokens.mono,
          fontSize: 8,
          '&:hover': { color: tokens.teal, background: 'rgba(31,111,107,.08)' },
        }}
      >
        Back to orchestrator
      </ButtonBase>
    </Stack>
  );
}

/** One sentence covering the Stop button's three states. */
function interruptStopLabel(interrupting: boolean, armed: boolean, pendingRole: string): string {
  if (interrupting) return 'Interrupting turn';
  if (armed) {
    return pendingRole
      ? `Stopping as soon as the ${pendingRole} starts — click to keep going`
      : 'Stopping as soon as this step starts — click to keep going';
  }
  if (pendingRole) return `Stop after the ${pendingRole} starts`;
  return 'Interrupt turn';
}

const AgentComposer = memo(function AgentComposer({
  insetLeft,
  insetRight,
  readingColumnWidth,
  showSelectionContext,
  focusRequest,
  draftInsertion,
  streaming,
  interrupting,
  interruptArmed,
  pendingRole,
  resumeRole,
  queueFull,
  modelOptions,
  catalogUnavailable,
  codexRuntime,
  lockedFamilies,
  compactRuntime,
  agentSettings,
  onRuntimeChange,
  onClearSelectionContext,
  onSend,
  onQueue,
  onCancel,
  onReleaseResumeRole,
}: {
  /** Rail widths to reserve, so the reading column lands where the transcript is. */
  insetLeft: string;
  insetRight: string;
  readingColumnWidth: string;
  showSelectionContext: boolean;
  focusRequest: number;
  /** A returned queued message; the counter is what makes a repeat land. */
  draftInsertion: { text: string; version: number };
  streaming: boolean;
  interrupting: boolean;
  /** An interrupt is waiting for `pendingRole` to produce its first output. */
  interruptArmed: boolean;
  /** The role currently inside its blind window, empty once it has spoken. */
  pendingRole: string;
  /** Set after an interrupt: the role the next message continues with. */
  resumeRole: string;
  queueFull: boolean;
  modelOptions: readonly CodexModelOption[];
  catalogUnavailable: boolean;
  codexRuntime: CodexRuntimeSelection;
  lockedFamilies: Record<keyof CodexRuntimeSelection, string> | null;
  compactRuntime: boolean;
  /** Only for which roles the model chips cover; the style itself is set elsewhere. */
  agentSettings: AgentSettings;
  onRuntimeChange: (role: keyof CodexRuntimeSelection, runtime: CodexRoleRuntime) => void;
  onClearSelectionContext: () => void;
  onSend: (message: string) => void;
  onQueue: (message: string) => void;
  onCancel: () => void;
  /** Send the next message to the driver instead of the role holding the thread. */
  onReleaseResumeRole: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [runtimeExpanded, setRuntimeExpanded] = useState(!compactRuntime);
  const inputElement = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusRequest > 0) inputElement.current?.focus();
  }, [focusRequest]);
  // The draft stays local: lifting it to the hook would re-render the whole
  // Agent page on every keystroke. A returned queued message therefore arrives
  // as a versioned prop rather than as a value.
  useEffect(() => {
    if (draftInsertion.version === 0) return;
    setDraft(draftInsertion.text);
    inputElement.current?.focus();
  }, [draftInsertion]);
  useEffect(() => {
    setRuntimeExpanded(!compactRuntime);
  }, [compactRuntime]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    // Enter does the same thing the visible button does: send when idle, queue
    // when a turn is running.
    if (streaming) {
      if (queueFull) return;
      setDraft('');
      onQueue(message);
      return;
    }
    setDraft('');
    onSend(message);
  };
  return (
    <Box
      component="form"
      onSubmit={submit}
      sx={{
        // The composer is the page's bottom band, like the header is its top
        // one. Both rails stop above it rather than running down beside the
        // input, which would dead-end their borders into this one.
        gridColumn: '1 / -1',
        gridRow: 3,
        pl: insetLeft,
        pr: insetRight,
        borderTop: `1px solid ${tokens.hair}`,
      }}
    >
      <Box
        data-testid="agent-composer-column"
        sx={{
          width: readingColumnWidth,
          mx: 'auto',
          px: 2,
          pt: compactRuntime ? 0.55 : 1.5,
          pb: compactRuntime ? 1 : 1.5,
        }}
      >
        <Box
          data-testid="agent-runtime-picker"
          sx={{ mb: compactRuntime ? 0.35 : showSelectionContext ? 0.8 : 1 }}
        >
          {compactRuntime && (
            <Stack direction="row" justifyContent="center">
              <ButtonBase
                type="button"
                aria-label={runtimeExpanded ? 'Collapse model controls' : 'Expand model controls'}
                aria-expanded={runtimeExpanded}
                onClick={() => setRuntimeExpanded((current) => !current)}
                sx={{
                  height: 16,
                  px: 0.55,
                  gap: 0.2,
                  borderRadius: 999,
                  color: tokens.sub2,
                  fontFamily: tokens.mono,
                  fontSize: 7.5,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  '&:hover': { color: tokens.teal, background: 'rgba(31,111,107,.055)' },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                Model
                <ExpandMoreRounded
                  sx={{
                    fontSize: 11,
                    transform: runtimeExpanded ? 'none' : 'rotate(180deg)',
                    transition: `transform 180ms ${tokens.ease}`,
                  }}
                />
              </ButtonBase>
            </Stack>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateRows: runtimeExpanded ? '1fr' : '0fr',
              opacity: runtimeExpanded ? 1 : 0,
              transition: `grid-template-rows 180ms ${tokens.ease}, opacity 140ms ${tokens.ease}`,
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          >
            <Box sx={{ minHeight: 0, overflow: 'hidden' }}>
              {/* The two style axes bracket the band, the runtime chips sit
                  between them. The plates themselves live in the empty
                  transcript body — this band reports the choice once it is
                  settled, it is not where the choice is made. */}
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ width: '100%', gap: 0.85, pt: compactRuntime ? 0.45 : 0 }}
              >
                <WorkingStyleTag axis="cast" settings={agentSettings} />
                <CodexRuntimePicker
                  models={modelOptions}
                  selection={codexRuntime}
                  roles={rolesForAgentMode(agentSettings.agentMode)}
                  lockedFamilies={lockedFamilies}
                  compact={compactRuntime}
                  // Deliberately editable mid-turn. Every turn pushes the
                  // runtime it is about to use, so a change made now lands on
                  // the next call — including a queued message, which runs with
                  // whatever is selected when it is finally sent. `lockedFamilies`
                  // still forbids the one change that cannot work: a rollout is
                  // only resumable by the family that recorded it.
                  disabled={false}
                  unavailable={catalogUnavailable}
                  onChange={onRuntimeChange}
                />
                <WorkingStyleTag axis="autonomy" settings={agentSettings} />
              </Stack>
            </Box>
          </Box>
        </Box>
        {showSelectionContext && <AnalyzerSelectionStrip onClear={onClearSelectionContext} />}
        {/* Only the implementer: interrupting the driver has always resumed the
            driver, so saying so adds a line without adding information. */}
        {resumeRole === 'implementer' && (
          <ResumeTargetStrip role={resumeRole} onRelease={onReleaseResumeRole} />
        )}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            minHeight: 44,
            gap: 0.8,
            p: 0.55,
            pl: 1.1,
            border: `1px solid ${tokens.hair}`,
            borderRadius: 1.15,
            background: tokens.leafbg,
            boxShadow: '0 9px 28px -24px rgba(42,38,34,.55)',
            '&:focus-within': {
              borderColor: 'rgba(31,111,107,.58)',
              boxShadow: '0 0 0 2px rgba(31,111,107,.075)',
            },
          }}
        >
          <Box
            component="input"
            ref={inputElement}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Continue the conversation"
            placeholder="Ask a follow-up"
            sx={{
              flex: 1,
              minWidth: 0,
              border: 0,
              outline: 0,
              background: 'transparent',
              color: tokens.ink,
              fontFamily: tokens.body,
              fontSize: 11.5,
              '&::placeholder': { color: tokens.sub2, opacity: 1 },
            }}
          />
          {streaming ? (
            <>
              {draft.trim() !== '' && (
                <ButtonBase
                  type="submit"
                  disabled={queueFull}
                  aria-label={queueFull ? 'Queue is full' : 'Queue message'}
                  title={
                    queueFull
                      ? `At most ${MAX_QUEUED_MESSAGES} messages can wait`
                      : 'Send after this turn finishes'
                  }
                  sx={{
                    width: 34,
                    height: 34,
                    flex: '0 0 auto',
                    border: `1px solid ${tokens.teal}`,
                    borderRadius: 0.85,
                    background: tokens.leafbg,
                    color: tokens.teal,
                    transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}`,
                    '&:hover': { background: 'rgba(31,111,107,.08)' },
                    '&:active': { transform: 'translateY(1px)' },
                    '&.Mui-disabled': { borderColor: tokens.hair, color: tokens.sub2 },
                    '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                  }}
                >
                  <PendingActionsRounded sx={{ fontSize: 16 }} />
                </ButtonBase>
              )}
              <ButtonBase
                type="button"
                onClick={onCancel}
                disabled={interrupting}
                aria-label={interruptStopLabel(interrupting, interruptArmed, pendingRole)}
                title={interruptStopLabel(interrupting, interruptArmed, pendingRole)}
                sx={{
                  width: 34,
                  height: 34,
                  flex: '0 0 auto',
                  // Armed reads as pending rather than active: the same stop
                  // mark, drawn as an outline that has not closed yet.
                  border: `1px ${interruptArmed ? 'dashed' : 'solid'} ${tokens.terra}`,
                  borderRadius: 0.85,
                  background: interruptArmed ? 'rgba(153,68,45,.08)' : tokens.leafbg,
                  color: tokens.terra,
                  opacity: interruptArmed ? 0.75 : 1,
                  transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}, opacity 120ms ${tokens.ease}`,
                  '&:hover': { background: 'rgba(153,68,45,.08)' },
                  '&:active': { transform: 'translateY(1px)' },
                  '&.Mui-disabled': { borderColor: tokens.hair, color: tokens.sub2 },
                  '&:focus-visible': {
                    outline: `2px solid ${tokens.terra}`,
                    outlineOffset: 1,
                  },
                }}
              >
                <StopRounded sx={{ fontSize: 16 }} />
              </ButtonBase>
            </>
          ) : (
            <ButtonBase
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send follow-up"
              sx={{
                width: 34,
                height: 34,
                flex: '0 0 auto',
                borderRadius: 0.85,
                background: tokens.ink,
                color: tokens.paper,
                transition: `transform 120ms ${tokens.ease}, background 120ms ${tokens.ease}`,
                '&:hover': { background: tokens.teal },
                '&:active': { transform: 'translateY(1px)' },
                '&.Mui-disabled': { background: tokens.hair, color: tokens.sub2 },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <ArrowUpwardRounded sx={{ fontSize: 17 }} />
            </ButtonBase>
          )}
        </Stack>
      </Box>
    </Box>
  );
});

function ConversationHistory({
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
  conversations: readonly ConversationSummary[];
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
            background: 'rgba(42,38,34,.12)',
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
          boxShadow: persistent ? 'none' : '16px 0 42px -30px rgba(42,38,34,.5)',
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
            <Typography sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
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
              fontSize: 10.5,
              fontWeight: 700,
              '&:hover': { borderColor: tokens.teal, background: 'rgba(31,111,107,.055)' },
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
                border: `1px solid ${persistent ? 'rgba(31,111,107,.42)' : tokens.hair}`,
                borderRadius: 0.8,
                color: persistent ? tokens.teal : tokens.sub2,
                background: persistent ? 'rgba(31,111,107,.055)' : 'transparent',
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
              borderColor: 'rgba(31,111,107,.58)',
              boxShadow: '0 0 0 2px rgba(31,111,107,.08)',
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
              fontSize: 11,
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
                  sx={{ bgcolor: 'rgba(91,82,71,.07)', borderRadius: 0.8 }}
                />
              ))}
            </Stack>
          ) : error ? (
            <Typography role="alert" sx={{ px: 1, py: 1, color: tokens.terra, fontSize: 10.5 }}>
              {error}
            </Typography>
          ) : visibleConversations.length === 0 ? (
            <Box sx={{ px: 1, py: 2.5 }}>
              <Typography sx={{ color: tokens.ink, fontSize: 11.5, fontWeight: 650 }}>
                {conversations.length === 0 ? 'No conversations yet' : 'No matching conversations'}
              </Typography>
              <Typography sx={{ mt: 0.35, color: tokens.sub2, fontSize: 10.5, lineHeight: 1.45 }}>
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
                      background: active ? 'rgba(31,111,107,.065)' : 'transparent',
                      '&:hover': { background: active ? 'rgba(31,111,107,.085)' : tokens.tile2 },
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
                            fontSize: 11.25,
                            fontWeight: active ? 700 : 540,
                          }}
                        >
                          {conversation.title || 'New conversation'}
                        </Typography>
                        <Typography
                          sx={{
                            mt: 0.1,
                            color: tokens.sub2,
                            fontFamily: tokens.mono,
                            fontSize: 8.25,
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
                          sx={{ px: 0.45, py: 0.35, color: tokens.sub2, fontSize: 8.5 }}
                        >
                          Cancel
                        </ButtonBase>
                        <ButtonBase
                          onClick={() => {
                            setPendingDelete(null);
                            void onDelete(conversation.id);
                          }}
                          sx={{ px: 0.45, py: 0.35, color: tokens.terra, fontSize: 8.5 }}
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
                          '&:hover': { color: tokens.terra, background: 'rgba(168,75,46,.06)' },
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

const HISTORY_PINNED_KEY = 'vibesim.conversation.history.pinned';

function savedHistoryPinned(): boolean {
  try {
    return window.localStorage.getItem(HISTORY_PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHistoryPinned(pinned: boolean): void {
  try {
    if (pinned) {
      window.localStorage.setItem(HISTORY_PINNED_KEY, 'true');
    } else {
      window.localStorage.removeItem(HISTORY_PINNED_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the current UI state still works.
  }
}

const PROGRESS_RAIL_KEY = 'vibesim.conversation.progress.hidden';

/** The rail is the point of the full-page surface, so it opts out, not in. */
function savedProgressRailOpen(): boolean {
  try {
    return window.localStorage.getItem(PROGRESS_RAIL_KEY) !== 'true';
  } catch {
    return true;
  }
}

function saveProgressRailOpen(open: boolean): void {
  try {
    if (open) {
      window.localStorage.removeItem(PROGRESS_RAIL_KEY);
    } else {
      window.localStorage.setItem(PROGRESS_RAIL_KEY, 'true');
    }
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the current UI state still works.
  }
}

function useAgentConversation(
  workspaceId: string,
  prompt: string,
  analyzerContext: AnalyzerTurnContextV2 | null,
  enabled: boolean,
  requireAnalyzerContext: boolean,
  onInitialPromptStarted?: () => void,
  onWorkspaceNameChange?: (name: string) => void,
) {
  const [modelOptions, setModelOptions] = useState<readonly CodexModelOption[]>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [codexRuntime, setCodexRuntime] = useState<CodexRuntimeSelection>(
    () => pendingCodexRuntime() ?? EMPTY_RUNTIME_SELECTION,
  );
  // What the server last stored for this conversation, so a turn only PATCHes on a
  // real change instead of on every send.
  const persistedRuntime = useRef<CodexRuntimeSelection | null>(null);
  // The durable preference until a conversation exists; then the server's own
  // record wins, because it is what the running Codex sessions were built from.
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(savedAgentSettings);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [messagePage, setMessagePage] = useState<ConversationMessagePage | null>(null);
  // Once a conversation has history its Codex session can only be resumed inside
  // the family that recorded it, so each role pins to the family it started on.
  const lockedFamilies = useMemo(() => {
    const started = persistedRuntime.current !== null && messages.length > 0;
    if (!started) return null;
    const familyOf = (runtime: CodexRoleRuntime) =>
      modelOptions.find((model) => model.id === runtime.model)?.family ?? '';
    const pinned = persistedRuntime.current as CodexRuntimeSelection;
    return {
      orchestrator: familyOf(pinned.orchestrator),
      implementer: familyOf(pinned.implementer),
      assistant: familyOf(pinned.assistant),
    };
  }, [messages.length, modelOptions]);
  // The same judgement the backend makes: the first message pins the working
  // style, because the Codex sessions a turn builds are per role.
  const agentSettingsLocked = messages.length > 0;
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [liveEvents, setLiveEvents] = useState<readonly ConversationTurnEvent[]>([]);
  const [toolCall, setToolCall] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [queued, setQueued] = useState<readonly QueuedMessage[]>([]);
  const [draftInsertion, setDraftInsertion] = useState({ text: '', version: 0 });
  // The role inside its interrupt blind window, and whether an interrupt is
  // waiting for it to speak. Empty role means nothing is blind right now:
  // either no role has started this turn (workspace and container setup, where
  // there is no handoff to lose) or the running one has already produced
  // output.
  const [pendingRole, setPendingRole] = useState('');
  // Whoever is running right now, blind or not. `pendingRole` cannot stand in:
  // it clears the moment the role speaks, and this outlives that. A turn that
  // opens at the implementer — the user answering one they interrupted — would
  // otherwise show an Orchestrator placeholder until the first output arrived.
  const [activeRole, setActiveRole] = useState<ConversationRole | null>(null);
  const [interruptArmed, setInterruptArmed] = useState(false);
  const [interruptedRole, setInterruptedRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Read at the top of `runTurn`, which clears the state in the same breath.
  const interruptedRoleRef = useRef('');
  interruptedRoleRef.current = interruptedRole;
  // Set only when the user redirects the conversation, and spent by the next
  // turn: the server carries the target across turns on its own, so overriding
  // it is a one-off, not a second copy of the same state.
  const resumeOverride = useRef<string | null>(null);
  const releaseResumeTarget = useCallback(() => {
    resumeOverride.current = '';
    setInterruptedRole('');
  }, []);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const streamingRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  // A turn belongs to the backend, not to the currently visible React tree. Moving
  // between conversations invalidates only this browser attachment; the backend
  // turn keeps running and can be rejoined through its conversation SSE endpoint.
  const conversationViewVersion = useRef(0);
  const selectionRequestVersion = useRef(0);
  // StrictMode replays effect setup/cleanup. Both setups must join the same
  // initialization rather than orphaning the just-created conversation.
  const initializationPromise = useRef<Promise<Conversation | null> | null>(null);
  const initialPromptStarted = useRef(false);
  const abortController = useRef<AbortController | null>(null);
  const namingPollGeneration = useRef(0);
  const queuedRef = useRef<readonly QueuedMessage[]>(queued);
  queuedRef.current = queued;
  // How the last turn ended, read by the queue when `streaming` falls. It
  // cannot be inferred from `streaming` alone, which also drops on a
  // conversation switch, an interrupt, and a failure.
  const turnOutcome = useRef<'completed' | 'interrupted' | 'failed'>('completed');
  /**
   * Claim a normal completion, unless `cancel` already claimed an interrupt.
   *
   * A cancelled turn still unwinds through its own success path, so the two
   * race; the interrupt wins because the user's stop is the later intent.
   */
  const markTurnCompleted = useCallback(() => {
    if (turnOutcome.current !== 'interrupted') turnOutcome.current = 'completed';
  }, []);
  const interruptArmedRef = useRef(false);
  interruptArmedRef.current = interruptArmed;
  const setStreamingState = useCallback((nextStreaming: boolean) => {
    streamingRef.current = nextStreaming;
    setStreaming(nextStreaming);
  }, []);
  const beginConversationView = useCallback(() => {
    const nextVersion = conversationViewVersion.current + 1;
    conversationViewVersion.current = nextVersion;
    abortController.current?.abort();
    abortController.current = null;
    setStreamingState(false);
    setInterrupting(false);
    setLiveEvents([]);
    setToolCall('');
    // A new turn opens a new blind window; the previous one's arming is spent.
    // The queue deliberately survives — this also runs at the start of every
    // turn, including the one draining the queue.
    setPendingRole('');
    setActiveRole(null);
    setInterruptArmed(false);
    return nextVersion;
  }, [setStreamingState]);
  // `cancel` is defined below and closes over state this runs before; a ref
  // keeps the blind-window bookkeeping out of its dependency cycle.
  const cancelRef = useRef<() => Promise<void>>(async () => {});
  /**
   * Track one role's interrupt blind window, and spend an armed interrupt.
   *
   * A role that has started but produced nothing cannot be interrupted without
   * losing whatever handoff its prompt carried, so the Stop button arms instead
   * of firing. `role_ready` is the moment that becomes safe, so it is also the
   * moment the deferred interrupt runs.
   */
  const noteRole = useCallback((role: string, ready: boolean) => {
    setPendingRole(ready ? '' : role);
    if (isConversationRole(role)) setActiveRole(role);
    if (!ready || !interruptArmedRef.current) return;
    interruptArmedRef.current = false;
    setInterruptArmed(false);
    void cancelRef.current();
  }, []);
  const refreshHistory = useCallback(async (): Promise<readonly ConversationSummary[] | null> => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const nextConversations = await listConversations(workspaceId);
      setConversations(nextConversations);
      return nextConversations;
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : 'Conversation history failed');
      return null;
    } finally {
      setHistoryLoading(false);
    }
  }, [workspaceId]);
  const pollGeneratedNames = useCallback(
    async (activeConversationId: string) => {
      const pollGeneration = ++namingPollGeneration.current;
      for (const delayMilliseconds of [1000, 2000, 4000, 8000]) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMilliseconds));
        if (namingPollGeneration.current !== pollGeneration) return;
        try {
          const [conversation, workspace] = await Promise.all([
            getConversation(workspaceId, activeConversationId),
            getWorkspace(workspaceId),
          ]);
          if (namingPollGeneration.current !== pollGeneration) return;
          if (conversation) {
            setConversations((current) =>
              current.map((summary) =>
                summary.id === conversation.id
                  ? {
                      ...summary,
                      title: conversation.title,
                      naming_state: conversation.naming_state,
                    }
                  : summary,
              ),
            );
          }
          onWorkspaceNameChange?.(workspace.displayName);
          if (conversation?.naming_state !== 'pending' && workspace.namingState !== 'pending') {
            return;
          }
        } catch {
          // Naming is optional; history remains usable and the next turn may retry.
          return;
        }
      }
    },
    [onWorkspaceNameChange, workspaceId],
  );
  const installConversation = useCallback(
    (conversation: Conversation, markInitialPromptHandled: boolean) => {
      initializationPromise.current = Promise.resolve(conversation);
      rememberActiveConversation(workspaceId, conversation.id);
      conversationIdRef.current = conversation.id;
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      setMessagePage(conversation.message_page ?? null);
      setLiveEvents([]);
      setToolCall('');
      setError(null);
      // The queue is this conversation's wait, not a durable outbox: carrying
      // it across would fire messages into a conversation they were not
      // written for.
      setQueued([]);
      setInterruptedRole(conversation.interrupted_role ?? '');
      if (conversation.codex_runtime) {
        persistedRuntime.current = conversation.codex_runtime;
        setCodexRuntime(conversation.codex_runtime);
      }
      // Opening an existing conversation must show that conversation's working
      // style, not this browser's preference — the two can disagree.
      setAgentSettings((current) =>
        agentSettingsFromConversation(conversation.agent_mode, conversation.autonomous, current),
      );
      if (markInitialPromptHandled) initialPromptStarted.current = true;
    },
    [workspaceId],
  );

  const resumeConversationView = useCallback(
    async (activeConversationId: string, viewVersion: number) => {
      const viewIsCurrent = () =>
        conversationViewVersion.current === viewVersion &&
        conversationIdRef.current === activeConversationId;
      if (!viewIsCurrent()) return;

      turnOutcome.current = 'failed';
      const controller = new AbortController();
      abortController.current = controller;
      setStreamingState(true);
      let namingScheduled = false;
      try {
        const resumed = await resumeConversationTurn(
          workspaceId,
          activeConversationId,
          {
            toolCall: (text) => {
              if (viewIsCurrent()) setToolCall(text);
            },
            event: (event) => {
              if (viewIsCurrent()) setLiveEvents((current) => [...current, event]);
            },
            role: (role, ready) => {
              if (viewIsCurrent()) noteRole(role, ready);
            },
            done: (completion) => {
              namingScheduled = completion.namingScheduled;
              setInterruptedRole(completion.interruptedRole);
              if (completion.outcome === 'request_user_input') {
                setComposerFocusRequest((current) => current + 1);
              }
            },
          },
          controller.signal,
        );
        if (!viewIsCurrent()) return;
        if (resumed) {
          const refreshed = await getConversation(workspaceId, activeConversationId);
          if (!viewIsCurrent()) return;
          if (refreshed) {
            setMessages(refreshed.messages);
            setMessagePage(refreshed.message_page ?? null);
          }
          if (namingScheduled) void pollGeneratedNames(activeConversationId);
        }
        // A rejoined turn that ends on its own is a normal completion: anything
        // queued while watching it should go out.
        markTurnCompleted();
      } catch (caught) {
        turnOutcome.current = 'failed';
        if (viewIsCurrent() && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Resume conversation failed');
        }
      } finally {
        if (viewIsCurrent()) {
          if (abortController.current === controller) abortController.current = null;
          setStreamingState(false);
          setLiveEvents([]);
          setToolCall('');
        }
      }
    },
    [markTurnCompleted, noteRole, pollGeneratedNames, setStreamingState, workspaceId],
  );

  const runTurn = useCallback(
    async (activeConversationId: string, text: string, context: AnalyzerTurnContextV2 | null) => {
      const trimmed = text.trim();
      if (!trimmed || streamingRef.current) return;
      // Pessimistic until the turn reaches its own end, so a turn that dies
      // somewhere unexpected never releases the queue behind it. The server
      // consumes `interrupted_role` with this same message.
      turnOutcome.current = 'failed';
      const resumeRedirect = resumeOverride.current;
      resumeOverride.current = null;
      const resumeTarget = resumeRedirect ?? interruptedRoleRef.current;
      setInterruptedRole('');
      const viewVersion = beginConversationView();
      // This turn opens at the role the user was talking to, and we know that
      // before any event arrives. Saying so from the first frame is what keeps
      // the placeholder card from naming the driving role and then flipping.
      if (isConversationRole(resumeTarget)) setActiveRole(resumeTarget);
      const viewIsCurrent = () =>
        conversationViewVersion.current === viewVersion &&
        conversationIdRef.current === activeConversationId;
      // Effort — and a sibling model — stay changeable mid-conversation, so the
      // runtime is pushed whenever it drifts from what the server last stored.
      // An unresolved selection (no catalog yet) is never pushed: the server's
      // own default is better than a placeholder.
      const runtimeResolved = Boolean(
        codexRuntime[rolesForAgentMode(agentSettings.agentMode)[0]].model,
      );
      if (
        runtimeResolved &&
        persistedRuntime.current !== null &&
        JSON.stringify(persistedRuntime.current) !== JSON.stringify(codexRuntime)
      ) {
        const updated = await updateConversationRuntime(
          workspaceId,
          activeConversationId,
          codexRuntime,
        );
        persistedRuntime.current = updated.codex_runtime ?? codexRuntime;
      }
      if (!viewIsCurrent()) return;
      const controller = new AbortController();
      abortController.current = controller;
      setMessages((current) => [...current, { role: 'user', content: trimmed }]);
      setLiveEvents([]);
      setToolCall('');
      setError(null);
      setStreamingState(true);
      let completionMessage: ConversationMessage | null = null;
      let namingScheduled = false;
      try {
        await sendConversationTurn(
          workspaceId,
          activeConversationId,
          trimmed,
          context,
          agentSettings,
          {
            toolCall: (text) => {
              if (viewIsCurrent()) setToolCall(text);
            },
            event: (event) => {
              if (viewIsCurrent()) setLiveEvents((current) => [...current, event]);
            },
            role: (role, ready) => {
              if (viewIsCurrent()) noteRole(role, ready);
            },
            done: (completion) => {
              if (!viewIsCurrent()) return;
              namingScheduled = completion.namingScheduled;
              completionMessage = {
                role: 'assistant',
                content: completion.text,
                activity: completion.failure
                  ? [{ kind: 'error', text: completion.failure.message }]
                  : [
                      {
                        kind: 'final',
                        text: completion.text,
                        outcome: completion.outcome,
                      },
                    ],
                citations: completion.citations,
                citation_dictionary_id: completion.citationDictionaryId,
                citation_dsl_version: completion.citationDslVersion,
                failure: completion.failure,
              };
              // Whoever answered keeps the conversation until a turn ends
              // through the driving role, which reports `''` here.
              setInterruptedRole(completion.interruptedRole);
              if (completion.outcome === 'request_user_input') {
                setComposerFocusRequest((current) => current + 1);
              }
            },
          },
          controller.signal,
          resumeRedirect ?? undefined,
        );
        const refreshed = await getConversation(workspaceId, activeConversationId);
        if (!viewIsCurrent()) return;
        if (refreshed) {
          setMessages(refreshed.messages);
          setMessagePage(refreshed.message_page ?? null);
        } else if (completionMessage) {
          setMessages((current) => [...current, completionMessage!]);
        }
        void refreshHistory();
        if (namingScheduled) void pollGeneratedNames(activeConversationId);
        // Only a turn that reached its own end releases the next queued
        // message; `cancel` has already claimed this ref if it was interrupted.
        markTurnCompleted();
      } catch (caught) {
        turnOutcome.current = 'failed';
        if (viewIsCurrent() && !controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : 'Conversation turn failed');
        }
      } finally {
        if (viewIsCurrent()) {
          if (abortController.current === controller) abortController.current = null;
          setStreamingState(false);
          setLiveEvents([]);
          setToolCall('');
        }
      }
    },
    [
      agentSettings,
      beginConversationView,
      codexRuntime,
      markTurnCompleted,
      noteRole,
      pollGeneratedNames,
      refreshHistory,
      setStreamingState,
      workspaceId,
    ],
  );

  const selectConversation = useCallback(
    async (nextConversationId: string) => {
      if (nextConversationId === conversationIdRef.current) return;
      const requestVersion = selectionRequestVersion.current + 1;
      selectionRequestVersion.current = requestVersion;
      try {
        const nextConversation = await getConversation(workspaceId, nextConversationId);
        if (selectionRequestVersion.current !== requestVersion) return;
        if (!nextConversation) {
          setHistoryError('That conversation is no longer available.');
          void refreshHistory();
          return;
        }
        const viewVersion = beginConversationView();
        installConversation(nextConversation, true);
        void resumeConversationView(nextConversation.id, viewVersion);
      } catch (caught) {
        if (selectionRequestVersion.current !== requestVersion) return;
        setHistoryError(caught instanceof Error ? caught.message : 'Load conversation failed');
      }
    },
    [
      beginConversationView,
      installConversation,
      refreshHistory,
      resumeConversationView,
      workspaceId,
    ],
  );

  const startConversation = useCallback(async () => {
    selectionRequestVersion.current += 1;
    beginConversationView();
    initializationPromise.current = null;
    initialPromptStarted.current = true;
    forgetActiveConversation(workspaceId);
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setMessagePage(null);
    setLiveEvents([]);
    setToolCall('');
    setError(null);
    setQueued([]);
    setInterruptedRole('');
  }, [beginConversationView, workspaceId]);

  const materializeConversation = useCallback(async (): Promise<Conversation> => {
    const creation = createConversation(workspaceId, codexRuntime, agentSettings);
    initializationPromise.current = creation;
    const conversation = await creation;
    installConversation(conversation, true);
    forgetPendingCodexRuntime();
    await refreshHistory();
    return conversation;
  }, [agentSettings, codexRuntime, installConversation, refreshHistory, workspaceId]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    void listCodexBackends()
      .then((catalog) => {
        if (disposed) return;
        setModelOptions(catalog.models);
        setCatalogUnavailable(catalog.models.length === 0);
        setCodexRuntime((current) => {
          // Keep whatever the conversation or Page 0 already chose; only fall
          // back for a role whose model this host cannot actually serve.
          const resolve = (runtime: CodexRoleRuntime, fallback: CodexRoleRuntime) => {
            const model = catalog.models.find(
              (option) => option.id === runtime.model && option.available,
            );
            if (!model) return fallback;
            return {
              ...runtime,
              serviceTier: model.serviceTiers.includes(runtime.serviceTier)
                ? runtime.serviceTier
                : model.defaultServiceTier,
            };
          };
          return {
            orchestrator: resolve(current.orchestrator, catalog.defaults.orchestrator),
            implementer: resolve(current.implementer, catalog.defaults.implementer),
            assistant: resolve(current.assistant, catalog.defaults.assistant),
          };
        });
      })
      .catch(() => {
        if (!disposed) setCatalogUnavailable(true);
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);

  const removeConversation = useCallback(
    async (removedConversationId: string) => {
      if (streamingRef.current) return;
      try {
        await deleteConversation(workspaceId, removedConversationId);
        const remainingConversations = await refreshHistory();
        if (removedConversationId !== conversationId || remainingConversations === null) return;
        const replacementSummary = remainingConversations[0];
        if (replacementSummary) {
          const replacement = await getConversation(workspaceId, replacementSummary.id);
          if (replacement) {
            installConversation(replacement, true);
            return;
          }
        }
        initializationPromise.current = null;
        forgetActiveConversation(workspaceId);
        setConversationId(null);
        setMessages([]);
        setMessagePage(null);
      } catch (caught) {
        setHistoryError(caught instanceof Error ? caught.message : 'Delete conversation failed');
      }
    },
    [conversationId, installConversation, refreshHistory, workspaceId],
  );

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let installedViewVersion: number | null = null;
    if (initializationPromise.current === null) {
      initializationPromise.current = (async () => {
        const rememberedId = activeConversationId(workspaceId);
        return rememberedId ? getConversation(workspaceId, rememberedId) : null;
      })();
    }
    const currentInitialization = initializationPromise.current;
    void (async () => {
      try {
        const conversation = await currentInitialization;
        if (disposed) return;
        void refreshHistory();
        if (!conversation) {
          conversationIdRef.current = null;
          setConversationId(null);
          setMessages([]);
          setMessagePage(null);
          return;
        }
        installedViewVersion = beginConversationView();
        installConversation(conversation, false);
        await resumeConversationView(conversation.id, installedViewVersion);
      } catch (caught) {
        if (initializationPromise.current === currentInitialization) {
          initializationPromise.current = null;
        }
        if (!disposed) {
          setStreamingState(false);
          setError(caught instanceof Error ? caught.message : 'Conversation initialization failed');
        }
      }
    })();
    return () => {
      disposed = true;
      if (
        installedViewVersion !== null &&
        conversationViewVersion.current === installedViewVersion
      ) {
        conversationViewVersion.current += 1;
        abortController.current?.abort();
        abortController.current = null;
      }
    };
  }, [
    beginConversationView,
    enabled,
    installConversation,
    refreshHistory,
    resumeConversationView,
    setStreamingState,
    workspaceId,
  ]);

  useEffect(
    () => () => {
      namingPollGeneration.current += 1;
    },
    [workspaceId],
  );

  useEffect(() => {
    if (
      !enabled ||
      messages.length > 0 ||
      streaming ||
      initialPromptStarted.current ||
      !prompt.trim() ||
      (requireAnalyzerContext && analyzerContext === null)
    ) {
      return;
    }
    initialPromptStarted.current = true;
    onInitialPromptStarted?.();
    void (async () => {
      try {
        const activeConversation = conversationId === null ? await materializeConversation() : null;
        await runTurn(activeConversation?.id ?? conversationId!, prompt, analyzerContext);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Conversation could not be started');
      }
    })();
  }, [
    analyzerContext,
    conversationId,
    enabled,
    messages.length,
    materializeConversation,
    onInitialPromptStarted,
    prompt,
    requireAnalyzerContext,
    runTurn,
    streaming,
  ]);

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    if (
      conversationId === null ||
      messagePage === null ||
      !messagePage.has_more ||
      loadingEarlier
    ) {
      return false;
    }
    setLoadingEarlier(true);
    setHistoryError(null);
    try {
      const earlier = await getConversation(workspaceId, conversationId, messagePage.start_index);
      if (!earlier?.message_page) return false;
      setMessages((current) => [...earlier.messages, ...current]);
      setMessagePage({
        start_index: earlier.message_page.start_index,
        end_index: messagePage.end_index,
        total_messages: messagePage.total_messages,
        has_more: earlier.message_page.has_more,
      });
      return true;
    } catch (caught) {
      setHistoryError(caught instanceof Error ? caught.message : 'Earlier messages failed');
      return false;
    } finally {
      setLoadingEarlier(false);
    }
  }, [conversationId, loadingEarlier, messagePage, workspaceId]);

  const cancel = useCallback(async () => {
    if (conversationId === null || !streamingRef.current || interrupting) return;
    setInterrupting(true);
    setError(null);
    turnOutcome.current = 'interrupted';
    // An interrupt is the user taking the wheel back, so nothing they lined up
    // behind the stopped turn goes out on its own. Suspension is one-way: a
    // later turn finishing normally must not release a message they stopped.
    setQueued((current) =>
      current.map((message) => (message.suspended ? message : { ...message, suspended: true })),
    );
    try {
      const { interruptedRole: stoppedRole } = await cancelConversationTurn(
        workspaceId,
        conversationId,
      );
      setInterruptedRole(stoppedRole);
      abortController.current?.abort();
      const refreshed = await getConversation(workspaceId, conversationId);
      if (refreshed) {
        setMessages(refreshed.messages);
        setMessagePage(refreshed.message_page ?? null);
      }
      void refreshHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Interrupt turn failed');
    } finally {
      setInterrupting(false);
      setStreamingState(false);
      setLiveEvents([]);
      setToolCall('');
      setPendingRole('');
      setInterruptArmed(false);
    }
  }, [conversationId, interrupting, refreshHistory, setStreamingState, workspaceId]);
  cancelRef.current = cancel;

  /**
   * The Stop button. Inside a role's blind window it arms instead of firing,
   * and a second press disarms — an interrupt there would drop the handoff the
   * starting role has not yet recorded, so there is no way to force one.
   */
  const requestCancel = useCallback(() => {
    if (!streamingRef.current || interrupting) return;
    if (pendingRole !== '') {
      setInterruptArmed((armed) => !armed);
      return;
    }
    void cancel();
  }, [cancel, interrupting, pendingRole]);
  const send = useCallback(
    (text: string) =>
      conversationId
        ? runTurn(conversationId, text, analyzerContext)
        : materializeConversation().then((conversation) =>
            runTurn(conversation.id, text, analyzerContext),
          ),
    [analyzerContext, conversationId, materializeConversation, runTurn],
  );

  const queueMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setQueued((current) =>
        current.length >= MAX_QUEUED_MESSAGES
          ? current
          : [
              ...current,
              {
                id: nextQueuedMessageId(),
                text: trimmed,
                // Snapshot, not a live read: the message was written about this
                // selection, and the user may be elsewhere by the time it goes.
                context: analyzerContext,
                suspended: false,
              },
            ],
      );
    },
    [analyzerContext],
  );
  const discardQueued = useCallback((id: string) => {
    setQueued((current) => current.filter((message) => message.id !== id));
  }, []);
  const returnQueuedToComposer = useCallback((id: string) => {
    const message = queuedRef.current.find((queuedMessage) => queuedMessage.id === id);
    if (!message) return;
    setQueued((current) => current.filter((queuedMessage) => queuedMessage.id !== id));
    setDraftInsertion((current) => ({ text: message.text, version: current.version + 1 }));
  }, []);

  const runTurnRef = useRef(runTurn);
  runTurnRef.current = runTurn;
  /**
   * Release one queued message per turn boundary.
   *
   * `streaming` is the only dependency on purpose. `runTurn` awaits a runtime
   * PATCH before it flips `streaming` back on, so with `queued` in the
   * dependency list the removal below would re-enter this effect inside that
   * gap and flush the whole queue into a single turn. Reading the queue through
   * a ref makes the false-edge of `streaming` the one and only trigger.
   */
  useEffect(() => {
    if (streaming || turnOutcome.current !== 'completed') return;
    const conversationIdForTurn = conversationIdRef.current;
    if (conversationIdForTurn === null) return;
    const next = queuedRef.current.find((message) => !message.suspended);
    if (!next) return;
    setQueued((current) => current.filter((message) => message.id !== next.id));
    void runTurnRef.current(conversationIdForTurn, next.text, next.context);
  }, [streaming]);

  return {
    conversationId,
    conversations,
    messages,
    liveEvents,
    toolCall,
    streaming,
    interrupting,
    error,
    historyLoading,
    historyError,
    canLoadEarlier: Boolean(messagePage?.has_more),
    messageStartIndex: messagePage?.start_index ?? 0,
    loadingEarlier,
    loadEarlier,
    send,
    cancel: requestCancel,
    queued,
    queueMessage,
    discardQueued,
    returnQueuedToComposer,
    draftInsertion,
    pendingRole,
    activeRole,
    interruptArmed,
    interruptedRole,
    releaseResumeTarget,
    selectConversation,
    startConversation,
    removeConversation,
    modelOptions,
    catalogUnavailable,
    codexRuntime,
    setCodexRuntime,
    lockedFamilies,
    agentSettings,
    agentSettingsLocked,
    setAgentSettings,
    composerFocusRequest,
  };
}

export default function AgentPane({
  workspaceId = 'w_main',
  workspaceName,
  prompt,
  onClose,
  onFold,
  onToggleFull,
  analyzerContext = null,
  enabled = true,
  requireAnalyzerContext = false,
  full = false,
  expanded = false,
  showSelectionContext = false,
  onInitialPromptStarted,
  onWorkspaceNameChange,
}: {
  workspaceId?: string;
  workspaceName?: string;
  prompt: string;
  onClose?: () => void;
  onFold?: () => void;
  onToggleFull?: () => void;
  analyzerContext?: AnalyzerTurnContextV2 | null;
  enabled?: boolean;
  requireAnalyzerContext?: boolean;
  full?: boolean;
  expanded?: boolean;
  showSelectionContext?: boolean;
  onInitialPromptStarted?: () => void;
  onWorkspaceNameChange?: (name: string) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(savedHistoryPinned);
  const [progressRailOpen, setProgressRailOpen] = useState(savedProgressRailOpen);
  const analyzerContextIdentity = useMemo(
    () => (analyzerContext === null ? null : JSON.stringify(analyzerContext)),
    [analyzerContext],
  );
  const [clearedAnalyzerContextIdentity, setClearedAnalyzerContextIdentity] = useState<
    string | null
  >(null);
  // Clearing the Agent attachment must not disturb the Analyzer's own chart selection.
  // A genuinely new chart selection gets a new identity and is attached automatically.
  const activeAnalyzerContext =
    analyzerContextIdentity !== null && analyzerContextIdentity === clearedAnalyzerContextIdentity
      ? null
      : analyzerContext;
  const conversation = useAgentConversation(
    workspaceId,
    prompt,
    activeAnalyzerContext,
    enabled,
    requireAnalyzerContext,
    onInitialPromptStarted,
    onWorkspaceNameChange,
  );
  // A persistent rail belongs to the roomy agent surfaces. Docked mode keeps the saved
  // preference but uses the overlay so history never consumes most of the analysis column.
  const roomy = full || expanded;
  const persistentHistory = historyPinned && roomy;
  const historyVisible = persistentHistory || historyOpen;
  // Both margins plus the 720px reading column need about this much room; below
  // it the reading column comes first and the progress rail steps aside.
  const roomForProgressRail = useMediaQuery('(min-width:1280px)', { noSsr: true });
  const progressRailVisible = roomy && progressRailOpen && roomForProgressRail;
  const readingColumnWidth = roomy ? 'min(720px,calc(100% - 40px))' : '100%';
  const activeConversationTitle =
    conversation.conversations.find((item) => item.id === conversation.conversationId)?.title ??
    'New conversation';
  const {
    cancel: cancelConversation,
    loadEarlier: loadEarlierConversationMessages,
    send: sendConversationMessage,
  } = conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const scrollFrameRef = useRef(0);
  const cancelOutlineJumpRef = useRef<(() => void) | null>(null);
  const pinnedAnchorRef = useRef<string | null>(null);
  const pinnedArrivedRef = useRef(false);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const outline = useMemo(
    () =>
      conversationOutline(
        conversation.messages,
        conversation.messageStartIndex,
        conversation.liveEvents,
        conversation.streaming,
      ),
    [
      conversation.liveEvents,
      conversation.messageStartIndex,
      conversation.messages,
      conversation.streaming,
    ],
  );
  // One rAF-throttled reader for both jobs the rail needs: whether following the
  // newest output is still wanted, and which entry the reader is looking at.
  const readScrollPosition = useCallback(() => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      // Only deliberate upward scrolling detaches the reader. Two things would
      // otherwise be mistaken for it: the frames of our own smooth scroll to the
      // bottom, and the browser's scroll anchoring, which moves scrollTop by
      // itself when a lazy block above the viewport mounts at a height the
      // estimate got wrong. Both come with a scrollHeight change, so a frame
      // that resized the content is never read as a gesture.
      const resized = scrollHeight !== lastScrollHeightRef.current;
      const scrolledUp = !resized && scrollTop < lastScrollTopRef.current - 1;
      lastScrollTopRef.current = scrollTop;
      lastScrollHeightRef.current = scrollHeight;
      if (scrollHeight - scrollTop - clientHeight <= 120) {
        stickToBottomRef.current = true;
      } else if (scrolledUp) {
        stickToBottomRef.current = false;
      }
      // A picked entry stays marked while it is on screen, and through the
      // frames of the jump that is still travelling towards it. Handing the mark
      // straight back to the reading position would light up a neighbour
      // whenever the column could not centre the target, which reads as the
      // click having gone somewhere else.
      const pinned = pinnedAnchorRef.current;
      if (pinned !== null) {
        if (outlineAnchorOnScreen(scrollElement, pinned)) {
          pinnedArrivedRef.current = true;
          setActiveAnchorId(pinned);
          return;
        }
        if (!pinnedArrivedRef.current) {
          setActiveAnchorId(pinned);
          return;
        }
        pinnedAnchorRef.current = null;
      }
      setActiveAnchorId(activeOutlineAnchor(scrollElement));
    });
  }, []);
  useEffect(
    () => () => {
      if (scrollFrameRef.current) window.cancelAnimationFrame(scrollFrameRef.current);
      // Clearing the id matters as much as cancelling the frame: it is also the
      // throttle guard, and a StrictMode remount would otherwise find it set and
      // drop every later read.
      scrollFrameRef.current = 0;
      cancelOutlineJumpRef.current?.();
    },
    [],
  );
  const selectOutlineEntry = useCallback((entry: OutlineEntry) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    cancelOutlineJumpRef.current?.();
    stickToBottomRef.current = false;
    pinnedAnchorRef.current = entry.anchorId;
    pinnedArrivedRef.current = false;
    setActiveAnchorId(entry.anchorId);
    cancelOutlineJumpRef.current = scrollToOutlineAnchor(scrollElement, entry);
  }, []);
  const toggleProgressRail = () => {
    const nextOpen = !progressRailOpen;
    setProgressRailOpen(nextOpen);
    saveProgressRailOpen(nextOpen);
  };
  const toggleHistoryPinned = () => {
    const nextPinned = !historyPinned;
    setHistoryPinned(nextPinned);
    saveHistoryPinned(nextPinned);
    setHistoryOpen(!nextPinned);
  };
  const loadEarlierMessages = useCallback(async () => {
    const scrollElement = scrollRef.current;
    if (scrollElement) {
      pendingScrollRestoreRef.current = {
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
      };
    }
    const loaded = await loadEarlierConversationMessages();
    if (!loaded) pendingScrollRestoreRef.current = null;
  }, [loadEarlierConversationMessages]);
  const sendMessage = useCallback(
    (message: string) => {
      // A new question always re-attaches the reader to the newest output.
      stickToBottomRef.current = true;
      void sendConversationMessage(message);
    },
    [sendConversationMessage],
  );
  const cancelTurn = useCallback(() => void cancelConversation(), [cancelConversation]);
  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const pendingRestore = pendingScrollRestoreRef.current;
    if (pendingRestore) {
      scrollElement.scrollTop =
        pendingRestore.scrollTop + (scrollElement.scrollHeight - pendingRestore.scrollHeight);
      lastScrollTopRef.current = scrollElement.scrollTop;
      pendingScrollRestoreRef.current = null;
      readScrollPosition();
      return;
    }
    // Following the newest output is only right while the reader is at the
    // bottom. Once they have scrolled up, or jumped to an entry in the progress
    // rail, a streaming turn must not drag them back.
    if (!stickToBottomRef.current) {
      // New content shifts which entry sits at the middle of the column.
      readScrollPosition();
      return;
    }
    if (typeof scrollElement.scrollTo === 'function') {
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: conversation.streaming ? 'auto' : 'smooth',
      });
    } else {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
    readScrollPosition();
  }, [
    conversation.liveEvents,
    conversation.messageStartIndex,
    conversation.messages,
    conversation.streaming,
    readScrollPosition,
  ]);
  return (
    <Box
      component="aside"
      aria-label="VibeSim Agent"
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'grid',
        gridTemplateColumns: [
          ...(persistentHistory ? [HISTORY_RAIL_WIDTH] : []),
          'minmax(0,1fr)',
          ...(progressRailVisible ? [PROGRESS_RAIL_WIDTH] : []),
        ].join(' '),
        gridTemplateRows: 'auto minmax(0,1fr) auto',
        position: 'relative',
        overflow: 'hidden',
        background: roomy ? tokens.paper : '#eee7da',
        transition: `grid-template-columns 190ms ${tokens.ease}`,
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Box
        sx={{
          gridColumn: '1 / -1',
          gridRow: 1,
          borderBottom: `1px solid ${tokens.hair}`,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ minHeight: 54, px: 2 }}
        >
          <Box sx={{ minWidth: 0, flex: 1, mr: 1 }}>
            <Typography
              sx={{ color: tokens.ink, fontFamily: tokens.serif, fontSize: 16, fontWeight: 600 }}
            >
              VibeSim Agent
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}>
              {workspaceName
                ? `${workspaceName} · ${activeConversationTitle}`
                : activeConversationTitle}
            </Typography>
          </Box>
          <Stack direction="row" sx={{ gap: 0.55 }}>
            <ButtonBase
              onClick={() => {
                if (persistentHistory) {
                  setHistoryPinned(false);
                  saveHistoryPinned(false);
                  return;
                }
                setHistoryOpen((current) => !current);
              }}
              aria-label={
                persistentHistory ? 'Hide conversation history' : 'Open conversation history'
              }
              aria-expanded={historyVisible}
              sx={{
                width: 32,
                height: 32,
                border: `1px solid ${historyVisible ? 'rgba(31,111,107,.42)' : tokens.hair}`,
                borderRadius: 0.85,
                color: historyVisible ? tokens.teal : tokens.sub,
                background: historyVisible ? 'rgba(31,111,107,.055)' : 'transparent',
                '&:hover': { borderColor: tokens.teal, color: tokens.teal },
                '&:active': { transform: 'translateY(1px)' },
                '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
              }}
            >
              <HistoryRounded sx={{ fontSize: 17 }} />
            </ButtonBase>
            {roomy && roomForProgressRail && (
              <ButtonBase
                onClick={toggleProgressRail}
                aria-label={progressRailOpen ? 'Hide progress summary' : 'Show progress summary'}
                aria-expanded={progressRailOpen}
                sx={{
                  width: 32,
                  height: 32,
                  border: `1px solid ${progressRailOpen ? 'rgba(31,111,107,.42)' : tokens.hair}`,
                  borderRadius: 0.85,
                  color: progressRailOpen ? tokens.teal : tokens.sub,
                  background: progressRailOpen ? 'rgba(31,111,107,.055)' : 'transparent',
                  '&:hover': { borderColor: tokens.teal, color: tokens.teal },
                  '&:active': { transform: 'translateY(1px)' },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                <TocRounded sx={{ fontSize: 16 }} />
              </ButtonBase>
            )}
            {onToggleFull && (
              <ButtonBase
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFull();
                }}
                aria-label={expanded ? 'Return Agent to split view' : 'Expand Agent to full page'}
                sx={{
                  width: 32,
                  height: 32,
                  border: `1px solid ${tokens.hair}`,
                  borderRadius: 0.85,
                  color: tokens.sub,
                  '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                {expanded ? (
                  <CloseFullscreenRounded sx={{ fontSize: 16 }} />
                ) : (
                  <OpenInFullRounded sx={{ fontSize: 15 }} />
                )}
              </ButtonBase>
            )}
            {onFold && (
              <ButtonBase
                onClick={(event) => {
                  event.stopPropagation();
                  onFold();
                }}
                aria-label="Fold Agent"
                sx={{
                  width: 32,
                  height: 32,
                  border: `1px solid ${tokens.hair}`,
                  borderRadius: 0.85,
                  color: tokens.sub,
                  '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                <KeyboardDoubleArrowLeftRounded sx={{ fontSize: 18 }} />
              </ButtonBase>
            )}
            {onClose && (
              <ButtonBase
                onClick={onClose}
                aria-label="Return to workspace home"
                title="Return to workspace home"
                sx={{
                  width: 32,
                  height: 32,
                  border: `1px solid ${tokens.hair}`,
                  borderRadius: 0.85,
                  color: tokens.sub,
                  '&:hover': { borderColor: tokens.sub2, color: tokens.ink },
                  '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
                }}
              >
                <ArrowBackRounded sx={{ fontSize: 17 }} />
              </ButtonBase>
            )}
          </Stack>
        </Stack>
      </Box>
      <ConversationHistory
        open={historyVisible}
        expanded={roomy}
        canPersist={roomy}
        persistent={persistentHistory}
        conversations={conversation.conversations}
        currentId={conversation.conversationId}
        loading={conversation.historyLoading}
        error={conversation.historyError}
        deletionDisabled={conversation.streaming}
        onClose={() => setHistoryOpen(false)}
        onTogglePersistent={toggleHistoryPinned}
        onNew={async () => {
          await conversation.startConversation();
          if (!persistentHistory) setHistoryOpen(false);
        }}
        onSelect={conversation.selectConversation}
        onDelete={conversation.removeConversation}
      />
      <Box
        ref={scrollRef}
        data-testid="agent-message-column"
        onScroll={readScrollPosition}
        sx={{
          gridColumn: persistentHistory ? 2 : 1,
          gridRow: 2,
          width: readingColumnWidth,
          mx: 'auto',
          minHeight: 0,
          overflowY: 'auto',
          px: 2,
          py: roomy ? 5 : 2.5,
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.hair} transparent`,
        }}
      >
        {!conversation.agentSettingsLocked && !conversation.historyLoading && (
          <ConversationOpening
            agentSettings={conversation.agentSettings}
            disabled={conversation.streaming}
            onChange={(settings) => {
              // Persist as the durable preference too: this choice is only
              // editable before a conversation starts, so the next start should
              // remember it.
              saveAgentSettings(settings);
              conversation.setAgentSettings(settings);
            }}
          />
        )}
        <ConversationTranscript
          workspaceId={workspaceId}
          messages={conversation.messages}
          messageStartIndex={conversation.messageStartIndex}
          liveEvents={conversation.liveEvents}
          toolCall={conversation.toolCall}
          streaming={conversation.streaming}
          error={conversation.error}
          canLoadEarlier={conversation.canLoadEarlier}
          loadingEarlier={conversation.loadingEarlier}
          onLoadEarlier={loadEarlierMessages}
          drivingRole={
            conversation.activeRole ?? rolesForAgentMode(conversation.agentSettings.agentMode)[0]
          }
          queued={conversation.queued}
          onDiscardQueued={conversation.discardQueued}
          onReturnQueuedToComposer={conversation.returnQueuedToComposer}
        />
      </Box>
      {progressRailVisible && (
        <ConversationProgressRail
          groups={outline}
          activeAnchorId={activeAnchorId}
          loading={conversation.messages.length === 0 && conversation.historyLoading}
          canLoadEarlier={conversation.canLoadEarlier}
          loadingEarlier={conversation.loadingEarlier}
          onLoadEarlier={loadEarlierMessages}
          onSelect={selectOutlineEntry}
        />
      )}
      <AgentComposer
        insetLeft={persistentHistory ? HISTORY_RAIL_WIDTH : '0px'}
        insetRight={progressRailVisible ? PROGRESS_RAIL_WIDTH : '0px'}
        readingColumnWidth={readingColumnWidth}
        showSelectionContext={showSelectionContext && activeAnalyzerContext !== null}
        focusRequest={conversation.composerFocusRequest}
        draftInsertion={conversation.draftInsertion}
        streaming={conversation.streaming}
        interrupting={conversation.interrupting}
        interruptArmed={conversation.interruptArmed}
        pendingRole={conversation.pendingRole}
        resumeRole={conversation.interruptedRole}
        onReleaseResumeRole={conversation.releaseResumeTarget}
        queueFull={conversation.queued.length >= MAX_QUEUED_MESSAGES}
        modelOptions={conversation.modelOptions}
        catalogUnavailable={conversation.catalogUnavailable}
        codexRuntime={conversation.codexRuntime}
        lockedFamilies={conversation.lockedFamilies}
        compactRuntime={!roomy}
        agentSettings={conversation.agentSettings}
        onRuntimeChange={(role, runtime) =>
          conversation.setCodexRuntime((current) => ({ ...current, [role]: runtime }))
        }
        onClearSelectionContext={() => setClearedAnalyzerContextIdentity(analyzerContextIdentity)}
        onSend={sendMessage}
        onQueue={conversation.queueMessage}
        onCancel={cancelTurn}
      />
    </Box>
  );
}
