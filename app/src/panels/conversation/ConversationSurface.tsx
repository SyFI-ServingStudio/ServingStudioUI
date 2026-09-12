import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CloseFullscreenRounded from '@mui/icons-material/CloseFullscreenRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import TocRounded from '@mui/icons-material/TocRounded';
import { Box, ButtonBase, Stack, Typography, useMediaQuery } from '@mui/material';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { tokens, withAlpha } from '../../ui/theme';
import { AgentComposer, type AgentSelectionContext } from './AgentComposer';
import { MAX_QUEUED_MESSAGES, type QueuedMessage } from './agentQueue';
import { HISTORY_RAIL_WIDTH, PROGRESS_RAIL_WIDTH } from './agentLayout';
import { rolesForAgentMode, saveAgentSettings } from './agentMode';
import type {
  AgentConversationSummary,
  AgentSettings,
  CodexModelOption,
  CodexRuntimeSelection,
  ConversationMessage,
  ConversationTurnEvent,
} from './agentTypes';
import ConversationHistory from './ConversationHistory';
import { conversationOutline, type OutlineEntry } from './agentOutline';
import ConversationProgressRail from './ConversationProgressRail';
import {
  ConversationOpening,
  ConversationTranscript,
  type RenderAgentMarkdown,
} from './ConversationTranscript';
import { savedHistoryPinned, saveHistoryPinned } from './historyPreference';
import {
  activeOutlineAnchor,
  outlineAnchorOnScreen,
  preserveTranscriptAnchor,
  scrollToOutlineAnchor,
} from './outlineNavigation';
import type { ConversationCard, ConversationRole } from './agentTimeline';

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

export interface AgentConversationViewModel {
  readonly conversationId: string | null;
  readonly conversations: readonly AgentConversationSummary[];
  readonly messages: readonly ConversationMessage[];
  readonly liveEvents: readonly ConversationTurnEvent[];
  readonly toolCall: string;
  readonly streaming: boolean;
  readonly interrupting: boolean;
  readonly error: string | null;
  readonly historyLoading: boolean;
  readonly historyError: string | null;
  readonly canLoadEarlier: boolean;
  readonly messageStartIndex: number;
  readonly loadingEarlier: boolean;
  readonly queued: readonly QueuedMessage[];
  readonly draftInsertion: { readonly text: string; readonly version: number };
  readonly pendingRole: string;
  readonly activeRole: ConversationRole | null;
  readonly interruptArmed: boolean;
  readonly interruptedRole: string;
  readonly modelOptions: readonly CodexModelOption[];
  readonly catalogUnavailable: boolean;
  readonly codexRuntime: CodexRuntimeSelection;
  readonly lockedFamilies: Record<keyof CodexRuntimeSelection, string> | null;
  readonly agentSettings: AgentSettings;
  readonly agentSettingsLocked: boolean;
  readonly composerFocusRequest: number;
  /** The input may be edited, but submit must preserve it until the session is known safe. */
  readonly sendUnavailable?: boolean;
  readonly inputUnavailable?: boolean;
  readonly connectionAction?: { readonly label: string; readonly activate: () => void } | null;
  readonly loadEarlier: () => Promise<boolean>;
  readonly send: (text: string) => Promise<void>;
  readonly cancel: () => void;
  readonly queueMessage: (text: string) => void;
  readonly discardQueued: (id: string) => void;
  readonly returnQueuedToComposer: (id: string) => void;
  readonly releaseResumeTarget: () => void;
  readonly selectConversation: (conversationId: string) => Promise<void>;
  readonly startConversation: () => Promise<void>;
  readonly removeConversation: (conversationId: string) => Promise<void>;
  readonly setCodexRuntime: (
    update: (current: CodexRuntimeSelection) => CodexRuntimeSelection,
  ) => void;
  readonly setAgentSettings: (settings: AgentSettings) => void;
}

export default function ConversationSurface({
  workspaceId,
  workspaceName,
  conversation,
  selectionContext,
  full = false,
  expanded = false,
  onClose,
  onFold,
  onToggleFull,
  onClearSelectionContext,
  renderMarkdown,
  onOpenManagedResult,
}: {
  workspaceId: string;
  workspaceName?: string;
  conversation: AgentConversationViewModel;
  selectionContext: AgentSelectionContext | null;
  full?: boolean;
  expanded?: boolean;
  onClose?: () => void;
  onFold?: () => void;
  onToggleFull?: () => void;
  onClearSelectionContext: () => void;
  renderMarkdown: RenderAgentMarkdown;
  onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPinned, setHistoryPinned] = useState(savedHistoryPinned);
  const [progressRailOpen, setProgressRailOpen] = useState(savedProgressRailOpen);
  // A persistent rail belongs to the roomy agent surfaces. Docked mode keeps the saved
  // preference but uses the overlay so history never consumes most of the analysis column.
  const roomy = full || expanded;
  const persistentHistory = historyPinned && roomy;
  const historyVisible = persistentHistory || historyOpen;
  // Both margins plus the 720px reading column need about this much room; below
  // it the reading column comes first and the progress rail steps aside.
  const roomForProgressRail = useMediaQuery('(min-width:1280px)', { noSsr: true });
  const progressRailVisible = roomy && progressRailOpen && roomForProgressRail;
  const readingColumnWidth = roomy && roomForProgressRail ? '70%' : '100%';
  const activeConversationTitle =
    conversation.conversations.find((item) => item.id === conversation.conversationId)?.title ??
    'New conversation';
  const {
    cancel: cancelConversation,
    loadEarlier: loadEarlierConversationMessages,
    send: sendConversationMessage,
  } = conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRestoreRef = useRef<{
    startIndex: number;
    scrollHeight: number;
    scrollTop: number;
    anchor: HTMLElement | null;
    anchorTop: number;
  } | null>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const lastScrollHeightRef = useRef(0);
  const scrollFrameRef = useRef(0);
  const cancelOutlineJumpRef = useRef<(() => void) | null>(null);
  const cancelScrollRestoreRef = useRef<(() => void) | null>(null);
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
      cancelScrollRestoreRef.current?.();
    },
    [],
  );
  const selectOutlineEntry = useCallback((entry: OutlineEntry) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    cancelOutlineJumpRef.current?.();
    cancelScrollRestoreRef.current?.();
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
    cancelScrollRestoreRef.current?.();
    const scrollElement = scrollRef.current;
    const columnTop = scrollElement?.getBoundingClientRect().top ?? 0;
    const anchor = scrollElement
      ? (Array.from(scrollElement.querySelectorAll<HTMLElement>('[data-outline-block]')).find(
          (element) =>
            /^t\d+$/.test(element.dataset.outlineBlock ?? '') &&
            element.getBoundingClientRect().bottom > columnTop,
        ) ?? null)
      : null;
    const restore = scrollElement
      ? {
          startIndex: conversation.messageStartIndex,
          scrollHeight: scrollElement.scrollHeight,
          scrollTop: scrollElement.scrollTop,
          anchor,
          anchorTop: (anchor?.getBoundingClientRect().top ?? columnTop) - columnTop,
        }
      : null;
    pendingScrollRestoreRef.current = restore;
    if (scrollElement && restore) {
      cancelScrollRestoreRef.current = preserveTranscriptAnchor(
        scrollElement,
        anchor,
        restore.anchorTop,
        () => {
          if (pendingScrollRestoreRef.current === restore) pendingScrollRestoreRef.current = null;
        },
      );
    }
    stickToBottomRef.current = false;
    const loaded = await loadEarlierConversationMessages();
    if (!loaded && pendingScrollRestoreRef.current === restore) {
      cancelScrollRestoreRef.current?.();
      pendingScrollRestoreRef.current = null;
    }
  }, [conversation.messageStartIndex, loadEarlierConversationMessages]);
  const sendMessage = useCallback(
    (message: string) => {
      cancelScrollRestoreRef.current?.();
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
      // Loading state also rerenders messages; only a prepended page can restore the position.
      if (conversation.messageStartIndex >= pendingRestore.startIndex) return;
      // Total height can also change below the reader as deferred messages mount.
      if (pendingRestore.anchor?.isConnected) {
        scrollElement.scrollTop +=
          pendingRestore.anchor.getBoundingClientRect().top -
          scrollElement.getBoundingClientRect().top -
          pendingRestore.anchorTop;
      } else {
        scrollElement.scrollTop =
          pendingRestore.scrollTop + (scrollElement.scrollHeight - pendingRestore.scrollHeight);
      }
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
      aria-label="ServingStudio Agent"
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
        background: roomy ? tokens.paper : tokens.tile,
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
              ServingStudio Agent
            </Typography>
            <Typography noWrap sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}>
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
                border: `1px solid ${historyVisible ? withAlpha(tokens.teal, 0.42) : tokens.hair}`,
                borderRadius: 0.85,
                color: historyVisible ? tokens.teal : tokens.sub,
                background: historyVisible ? withAlpha(tokens.teal, 0.055) : 'transparent',
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
                  border: `1px solid ${progressRailOpen ? withAlpha(tokens.teal, 0.42) : tokens.hair}`,
                  borderRadius: 0.85,
                  color: progressRailOpen ? tokens.teal : tokens.sub,
                  background: progressRailOpen ? withAlpha(tokens.teal, 0.055) : 'transparent',
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
          renderMarkdown={renderMarkdown}
          onOpenManagedResult={onOpenManagedResult}
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
        selectionContext={selectionContext}
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
        sendUnavailable={conversation.sendUnavailable}
        inputUnavailable={conversation.inputUnavailable}
        connectionAction={conversation.connectionAction}
        onRuntimeChange={(role, runtime) =>
          conversation.setCodexRuntime((current) => ({ ...current, [role]: runtime }))
        }
        onClearSelectionContext={onClearSelectionContext}
        onSend={sendMessage}
        onQueue={conversation.queueMessage}
        onCancel={cancelTurn}
      />
    </Box>
  );
}
