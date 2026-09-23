import AdjustRounded from '@mui/icons-material/AdjustRounded';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import HexagonOutlined from '@mui/icons-material/HexagonOutlined';
import HubOutlined from '@mui/icons-material/HubOutlined';
import NorthEastRounded from '@mui/icons-material/NorthEastRounded';
import StopRounded from '@mui/icons-material/StopRounded';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';

import { tokens, withAlpha } from '../../ui/theme';
import AgentModePicker from './AgentModePicker';
import { CodexRuntimeTag } from './CodexRuntimePicker';
import { type QueuedMessage } from './agentQueue';
import { conversationCards, type ConversationCard, type ConversationRole } from './agentTimeline';
import {
  LIVE_OUTLINE_BLOCK_ID,
  managedResultLabel,
  managedResultStatus,
  outlineBlockId,
  outlineCardAnchorId,
  outlineNoteAnchorId,
} from './agentOutline';
import type {
  AgentCitation,
  AgentSettings,
  CodexRoleRuntime,
  ConversationMessage,
  ConversationTurnEvent,
} from './agentTypes';

export type RenderAgentMarkdown = (
  text: string,
  citations: readonly AgentCitation[],
  workspaceId: string,
  compact?: boolean,
) => ReactNode;

type RoleTone = 'orchestrator' | 'implementer' | 'assistant' | 'answer' | 'error' | 'stopped';

const roleStyle: Record<RoleTone, { color: string; line: string; wash: string }> = {
  orchestrator: {
    color: tokens.gold,
    line: withAlpha(tokens.gold, 0.3),
    wash: withAlpha(tokens.gold, 0.055),
  },
  implementer: {
    color: tokens.teal,
    line: withAlpha(tokens.teal, 0.3),
    wash: withAlpha(tokens.teal, 0.055),
  },
  // Olive sits between the orchestrator's gold and the implementer's teal, and
  // never appears beside either: a conversation runs one cast or the other.
  assistant: {
    color: tokens.olive,
    line: withAlpha(tokens.olive, 0.3),
    wash: withAlpha(tokens.olive, 0.055),
  },
  answer: {
    color: tokens.terra,
    line: withAlpha(tokens.terra, 0.3),
    wash: withAlpha(tokens.terra, 0.055),
  },
  error: {
    color: tokens.terra,
    line: withAlpha(tokens.terra, 0.32),
    wash: withAlpha(tokens.terra, 0.065),
  },
  // The one card with no colour of its own. A turn the reader stopped did not
  // succeed and did not go wrong, and either hue would say it did.
  stopped: {
    color: tokens.sub,
    line: withAlpha(tokens.sub, 0.3),
    wash: withAlpha(tokens.sub, 0.05),
  },
};

const roleTitles: Record<ConversationRole, string> = {
  orchestrator: 'Orchestrator',
  implementer: 'Implementer',
  assistant: 'Assistant',
};

/** Hub for coordinating, wrench for building, and one solid for doing both. */
function roleIcon(role: ConversationRole) {
  if (role === 'implementer') return <BuildOutlined sx={{ fontSize: 15 }} />;
  if (role === 'assistant') return <HexagonOutlined sx={{ fontSize: 15 }} />;
  return <HubOutlined sx={{ fontSize: 15 }} />;
}

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
      boxShadow: `0 0 0 2px ${withAlpha(tokens.teal, 0.45)}`,
    },
    '@keyframes outlineFlash': {
      from: { boxShadow: `0 0 0 3px ${withAlpha(tokens.teal, 0.3)}` },
      to: { boxShadow: `0 0 0 3px ${withAlpha(tokens.teal, 0)}` },
    },
  } as const;
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
        p: { xs: 1.5, sm: 2 },
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: tokens.tile,
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
          <Typography sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
            round {round}
          </Typography>
        )}
        {runtime?.model && <CodexRuntimeTag model={runtime.model} effort={runtime.effort} />}
        <Typography
          sx={{
            ml: 'auto',
            color: style.color,
            fontFamily: tokens.body,
            fontSize: 12,
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
  renderMarkdown,
}: {
  children: ReactNode;
  workspaceId?: string;
  level?: 'progress' | 'milestone';
  /** Present on milestones, which the progress rail navigates to individually. */
  anchorId?: string;
  renderMarkdown: RenderAgentMarkdown;
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
          renderMarkdown(children, [], workspaceId ?? 'w_main', true)
        ) : (
          <Typography sx={{ color: tokens.ink, fontSize: 14, lineHeight: 1.7 }}>
            {children}
          </Typography>
        )}
      </Stack>
    );
  }
  if (typeof children === 'string') {
    return <>{renderMarkdown(children, [], workspaceId ?? 'w_main', true)}</>;
  }
  return (
    <Typography sx={{ color: tokens.sub, fontSize: 14, lineHeight: 1.7 }}>{children}</Typography>
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
        color: tokens.sub,
        fontFamily: tokens.body,
        fontSize: 12,
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
              background: tokens.sub2,
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
          fontSize: 12,
          fontWeight: 400,
          letterSpacing: 0,
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

function FailureCard({
  text,
  workspaceId,
  renderMarkdown,
}: {
  text: string;
  workspaceId?: string;
  renderMarkdown: RenderAgentMarkdown;
}) {
  return (
    <RoleCard
      tone="error"
      icon={<ErrorOutlineRounded sx={{ fontSize: 15 }} />}
      title="Agent unavailable"
      status="retry"
    >
      <Note workspaceId={workspaceId} renderMarkdown={renderMarkdown}>
        {text}
      </Note>
    </RoleCard>
  );
}

function Handoff({
  from,
  to,
  text,
  workspaceId,
  renderMarkdown,
}: {
  from: 'Orchestrator' | 'Implementer';
  to: 'Orchestrator' | 'Implementer';
  text: string;
  workspaceId: string;
  renderMarkdown: RenderAgentMarkdown;
}) {
  const isImplementationReport = from === 'Implementer';
  const style = roleStyle[isImplementationReport ? 'implementer' : 'orchestrator'];
  return (
    <Box
      component="section"
      aria-label={isImplementationReport ? 'Implementation report' : 'Delegated task'}
      sx={{
        p: { xs: 1.5, sm: 2 },
        border: `1px solid ${style.line}`,
        borderLeft: `2px solid ${style.color}`,
        borderRadius: 1.2,
        background: tokens.tile,
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
          <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
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
        {renderMarkdown(text, [], workspaceId, true)}
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
        px: { xs: 1.5, sm: 2 },
        py: { xs: 1.25, sm: 1.65 },
        border: `1px solid ${tokens.hair}`,
        borderRadius: '10px 10px 3px 10px',
        background: tokens.tile,
        color: tokens.ink,
        // The same reading size as the answer it sits beside.
        fontSize: 14,
        lineHeight: 1.7,
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
                fontFamily: tokens.body,
                fontSize: 12,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
              }}
            >
              {message.suspended ? 'Suspended' : 'Queued'}
            </Typography>
            {message.context !== null && (
              <Typography
                sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}
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
                  fontFamily: tokens.body,
                  fontSize: 12,
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
              <CloseRounded sx={{ fontSize: 12 }} />
            </ButtonBase>
          </Stack>
          {/* Same geometry as a sent message, drawn unsent: dashed edge, paper
              rather than tile, dimmed ink. */}
          <Box
            sx={{
              px: { xs: 1.5, sm: 2 },
              py: { xs: 1.25, sm: 1.65 },
              border: `1px dashed ${message.suspended ? withAlpha(tokens.terra, 0.4) : tokens.hair}`,
              borderRadius: '10px 10px 3px 10px',
              background: tokens.leafbg,
              color: tokens.sub,
              fontSize: 12,
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
  renderMarkdown,
  onOpenManagedResult,
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
  renderMarkdown: RenderAgentMarkdown;
  onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
}) {
  if (card.type === 'handoff') {
    return (
      <Handoff
        from={card.variant === 'delegated-task' ? 'Orchestrator' : 'Implementer'}
        to={card.variant === 'delegated-task' ? 'Implementer' : 'Orchestrator'}
        text={card.text}
        workspaceId={workspaceId}
        renderMarkdown={renderMarkdown}
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
              renderMarkdown={renderMarkdown}
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
    return (
      <ButtonBase
        disabled={!ready || (typedJob ? !card.analyzerResourceId : !card.experimentId)}
        onClick={() => onOpenManagedResult(card)}
        sx={{
          width: '100%',
          p: { xs: 1.5, sm: 2 },
          justifyContent: 'flex-start',
          border: `1px solid ${
            failed
              ? withAlpha(tokens.terra, 0.3)
              : ready
                ? withAlpha(tokens.teal, 0.34)
                : tokens.hair
          }`,
          borderLeft: `2px solid ${failed ? tokens.terra : tokens.teal}`,
          borderRadius: 1.1,
          background: ready ? withAlpha(tokens.teal, 0.055) : withAlpha(tokens.sub, 0.035),
          textAlign: 'left',
          '&:hover': ready ? { background: withAlpha(tokens.teal, 0.09) } : undefined,
          '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
        }}
      >
        <Stack direction="row" alignItems="center" sx={{ width: '100%', minWidth: 0, gap: 1 }}>
          {failed ? (
            <ErrorOutlineRounded sx={{ color: tokens.terra, fontSize: 16 }} />
          ) : card.jobKind === 'kernel_profile' || card.jobKind === 'kernel_measure' ? (
            <BuildOutlined sx={{ color: ready ? tokens.teal : tokens.gold, fontSize: 16 }} />
          ) : ready ? (
            <CheckCircleOutlineRounded sx={{ color: tokens.teal, fontSize: 16 }} />
          ) : (
            <AdjustRounded sx={{ color: tokens.gold, fontSize: 16 }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: tokens.ink, fontSize: 12, fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
              {card.artifactPath || card.experimentPath}
            </Typography>
          </Box>
          {ready && <NorthEastRounded sx={{ ml: 'auto', color: tokens.teal, fontSize: 15 }} />}
        </Stack>
      </ButtonBase>
    );
  }
  if (card.type === 'error') {
    return (
      <FailureCard text={card.text} workspaceId={workspaceId} renderMarkdown={renderMarkdown} />
    );
  }
  if (card.outcome === 'cancelled') {
    return (
      <RoleCard
        tone="stopped"
        icon={<StopRounded sx={{ fontSize: 15 }} />}
        title="Stopped"
        status="interrupted"
      >
        {renderMarkdown(card.text, message?.citations ?? [], workspaceId)}
      </RoleCard>
    );
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
      {renderMarkdown(card.text, message?.citations ?? [], workspaceId)}
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
  renderMarkdown,
  onOpenManagedResult,
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
  renderMarkdown: RenderAgentMarkdown;
  onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
}) {
  const cards = conversationCards(events);
  // A stored turn carries its own cast, so an old orchestrated transcript keeps
  // its colours no matter what the conversation runs today.
  const drivingRole =
    cards.find((card): card is Extract<ConversationCard, { type: 'role' }> => card.type === 'role')
      ?.role ?? expectedDrivingRole;
  if (message?.failure) {
    return (
      <FailureCard
        text={message.failure.message}
        workspaceId={workspaceId}
        renderMarkdown={renderMarkdown}
      />
    );
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
          renderMarkdown={renderMarkdown}
          onOpenManagedResult={onOpenManagedResult}
        />
      </LazyTranscriptBlock>
    );
  });
}

const PersistedConversationMessage = memo(function PersistedConversationMessage({
  message,
  workspaceId,
  blockId,
  renderMarkdown,
  onOpenManagedResult,
}: {
  message: ConversationMessage;
  workspaceId: string;
  blockId: string;
  renderMarkdown: RenderAgentMarkdown;
  onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
}) {
  if (message.role === 'user') return <UserMessage>{message.content}</UserMessage>;
  return (
    <AssistantTimeline
      message={message}
      events={
        message.activity !== null && message.activity !== undefined
          ? message.activity
          : [{ kind: 'final', text: message.content }]
      }
      streaming={false}
      toolCall=""
      workspaceId={workspaceId}
      blockId={blockId}
      renderMarkdown={renderMarkdown}
      onOpenManagedResult={onOpenManagedResult}
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
export function ConversationOpening({
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
          fontFamily: tokens.body,
          fontSize: 12,
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

export interface ConversationTranscriptProps {
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
  drivingRole: ConversationRole;
  queued?: readonly QueuedMessage[];
  onDiscardQueued?: (id: string) => void;
  onReturnQueuedToComposer?: (id: string) => void;
  renderMarkdown: RenderAgentMarkdown;
  onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
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
  renderMarkdown,
  onOpenManagedResult,
}: ConversationTranscriptProps) {
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
            fontFamily: tokens.body,
            fontSize: 12,
            '&:hover': { color: tokens.teal, borderColor: withAlpha(tokens.teal, 0.35) },
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
              renderMarkdown={renderMarkdown}
              onOpenManagedResult={onOpenManagedResult}
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
          renderMarkdown={renderMarkdown}
          onOpenManagedResult={onOpenManagedResult}
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
          sx={{ color: tokens.terra, fontFamily: tokens.body, fontSize: 12 }}
        >
          {error}
        </Typography>
      )}
    </Stack>
  );
});
