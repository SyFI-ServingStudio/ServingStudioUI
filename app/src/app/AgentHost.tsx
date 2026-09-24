/**
 * The exact Agent surface backed by the canonical session controller.
 *
 * This is application assembly: Location decides which conversation is shown,
 * session owns its network lifecycle, and the panel receives the same closed
 * view model it used before the refactor. Browser-only queue and picker state
 * stay here because neither is shared or addressable.
 */
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  conversationIdSchema,
  workspaceIdSchema,
  workspaceOf,
  type ChatRef,
  type ConversationId,
  type Location,
  type Navigate,
  type WorkspaceId,
} from '../location';
import type { AgentSelectionContext } from '../panels/conversation/AgentComposer';
import {
  MAX_QUEUED_MESSAGES,
  nextQueuedMessageId,
  type QueuedMessage,
} from '../panels/conversation/agentQueue';
import type {
  AgentConversationSummary,
  AgentSettings,
  AgentWorkspaceConversations,
  CodexRoleRuntime,
  CodexRuntimeSelection,
} from '../panels/conversation/agentTypes';
import { savedAgentSettings } from '../panels/conversation/agentMode';
import { EMPTY_RUNTIME_SELECTION, runtimeModel } from '../panels/conversation/codexRuntime';
import ConversationSurface, {
  type AgentConversationViewModel,
} from '../panels/conversation/ConversationSurface';
import type { RenderAgentMarkdown } from '../panels/conversation/ConversationTranscript';
import {
  activeToolCall,
  eventsForConversation,
  messagesForConversation,
} from '../panels/conversation/sessionView';
import {
  deleteConversation,
  describeError,
  getWorkspace,
  listCodexBackends,
  listConversations,
  listWorkspaces,
  renameConversation as renameConversationTitle,
  updateConversationRuntime,
} from '../session/api';
import type { Unsubscribe } from '../session/controller';
import { startConversation } from '../session/draft';
import { sessionKey, type SessionRef } from '../session/types';
import { useSession } from '../session/useSession';
import {
  lastMessageMarker,
  reconciledRuntime,
  resolvedRuntime,
  roleState,
  sameRuntime,
  shouldSpendArmedInterrupt,
  storedTerminalResult,
  terminalResult,
} from './agentHostProjection';
import {
  chatAt,
  closeConversation,
  finishDraft,
  showConversation,
  startNewConversation,
} from './agentLocation';
import type { ConversationCard } from '../panels/conversation/agentTimeline';
import { clearEntryDraft, readEntryDraft } from './entryDraft';

export interface AgentHostProps {
  readonly location: Location;
  readonly navigate: Navigate;
  readonly selectionContext: AgentSelectionContext | null;
  readonly analyzerContext: Readonly<Record<string, unknown>> | null;
  readonly onClearSelectionContext: () => void;
  readonly renderMarkdown: RenderAgentMarkdown;
  readonly onOpenManagedResult: (card: Extract<ConversationCard, { type: 'job' }>) => void;
  /** Keep the mounted surface state while releasing its live session connection. */
  readonly visible?: boolean;
  readonly full?: boolean;
  readonly expanded?: boolean;
  readonly onFold?: () => void;
  readonly onToggleFull?: () => void;
}

interface Lease {
  readonly session: string;
  readonly release: Unsubscribe;
}

interface SharedAgentState {
  readonly workspace: WorkspaceId;
  readonly workspaceName?: string;
  readonly conversations: readonly AgentConversationSummary[];
  readonly otherWorkspaces: readonly AgentWorkspaceConversations[];
  readonly historyLoading: boolean;
  readonly historyError: string | null;
  readonly modelOptions: AgentConversationViewModel['modelOptions'];
  readonly catalogUnavailable: boolean;
  readonly codexRuntime: CodexRuntimeSelection;
  readonly setCodexRuntime: AgentConversationViewModel['setCodexRuntime'];
  readonly agentSettings: AgentSettings;
  readonly setAgentSettings: Dispatch<SetStateAction<AgentSettings>>;
  readonly refreshHistory: () => Promise<readonly AgentConversationSummary[] | null>;
  readonly startNew: () => Promise<void>;
  readonly renameConversation: (id: string, workspace: string, title: string) => Promise<void>;
  readonly selectConversation: (id: string, workspace?: string) => Promise<void>;
  readonly removeConversation: (id: string) => Promise<void>;
}

function summaryForPanel(
  summary: Awaited<ReturnType<typeof listConversations>>[number],
): AgentConversationSummary {
  return {
    id: summary.id,
    title: summary.title ?? 'New conversation',
    ...(summary.updated_at == null ? {} : { updated_at: summary.updated_at }),
  };
}

/** The Agent is rendered only for Locations that actually carry a ChatRef. */
export default function AgentHost(props: AgentHostProps) {
  const chat = chatAt(props.location);
  if (chat === null) return null;
  return <AddressedAgentHost key={workspaceOf(props.location)} {...props} chat={chat} />;
}

function AddressedAgentHost({
  location,
  navigate,
  chat,
  ...surface
}: AgentHostProps & { readonly chat: ChatRef }) {
  const workspace = workspaceOf(location);
  const entryDraft = useMemo(() => readEntryDraft(workspace), [workspace]);
  const locationRef = useRef(location);
  locationRef.current = location;
  const mounted = useRef(true);
  const lease = useRef<Lease | null>(null);
  const showing =
    chat.state === 'created'
      ? sessionKey({ workspace: chat.workspace, conversation: chat.id })
      : null;
  const [workspaceName, setWorkspaceName] = useState<string>();
  const [conversations, setConversations] = useState<readonly AgentConversationSummary[]>([]);
  const [otherWorkspaces, setOtherWorkspaces] = useState<readonly AgentWorkspaceConversations[]>(
    [],
  );
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<AgentConversationViewModel['modelOptions']>([]);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [codexRuntime, setCodexRuntimeState] = useState<CodexRuntimeSelection>(
    entryDraft?.runtime ?? EMPTY_RUNTIME_SELECTION,
  );
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(savedAgentSettings);
  const historyGeneration = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      historyGeneration.current += 1;
    };
  }, []);
  const isCurrentWorkspace = useCallback(
    () => mounted.current && workspaceOf(locationRef.current) === workspace,
    [workspace],
  );

  const dropLease = useCallback(() => {
    const held = lease.current;
    lease.current = null;
    held?.release();
  }, []);
  useEffect(() => {
    if (
      lease.current !== null &&
      (lease.current.session !== showing || surface.visible === false)
    ) {
      dropLease();
    }
  }, [dropLease, showing, surface.visible]);
  useEffect(() => dropLease, [dropLease]);

  const refreshHistory = useCallback(async () => {
    const generation = historyGeneration.current + 1;
    historyGeneration.current = generation;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const summaries = (await listConversations(workspace)).map(summaryForPanel);
      if (historyGeneration.current !== generation || !isCurrentWorkspace()) return null;
      setConversations(summaries);
      return summaries;
    } catch (error) {
      if (historyGeneration.current !== generation || !isCurrentWorkspace()) return null;
      setHistoryError(describeError(error));
      return null;
    } finally {
      if (historyGeneration.current === generation) setHistoryLoading(false);
    }
  }, [isCurrentWorkspace, workspace]);

  useEffect(() => {
    const abort = new AbortController();
    setWorkspaceName(undefined);
    void getWorkspace(workspace, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted && isCurrentWorkspace()) setWorkspaceName(value.label);
      })
      .catch(() => {
        // The workspace id still labels the surface; display-name lookup is optional.
      });
    void listCodexBackends(abort.signal)
      .then((catalog) => {
        if (abort.signal.aborted || !isCurrentWorkspace()) return;
        setModelOptions(catalog.models);
        setCatalogUnavailable(catalog.models.length === 0);
        setCodexRuntimeState((current) =>
          resolvedRuntime(current, catalog.defaults, catalog.models),
        );
      })
      .catch(() => {
        if (!abort.signal.aborted) setCatalogUnavailable(true);
      });
    void refreshHistory();
    return () => abort.abort();
  }, [isCurrentWorkspace, refreshHistory, workspace]);

  // The other workspaces are only a way to jump elsewhere, so each is read once
  // per visit and a workspace that fails to list is left out rather than
  // reported: the rail's error line belongs to the workspace on screen.
  useEffect(() => {
    const abort = new AbortController();
    setOtherWorkspaces([]);
    void listWorkspaces(abort.signal)
      .then(async (catalog) => {
        const others = catalog.workspaces.filter(
          (candidate) => !candidate.archived && candidate.id !== workspace,
        );
        const listed = await Promise.allSettled(
          others.map(async (candidate) => ({
            id: candidate.id,
            label: candidate.label,
            conversations: (await listConversations(candidate.id, abort.signal)).map(
              summaryForPanel,
            ),
          })),
        );
        if (abort.signal.aborted || !isCurrentWorkspace()) return;
        setOtherWorkspaces(
          listed.flatMap((result) =>
            result.status === 'fulfilled' && result.value.conversations.length > 0
              ? [result.value]
              : [],
          ),
        );
      })
      .catch(() => {
        // Without the catalog the rail still lists this workspace's conversations.
      });
    return () => abort.abort();
  }, [isCurrentWorkspace, workspace]);

  const setCodexRuntime = useCallback<AgentConversationViewModel['setCodexRuntime']>((update) => {
    setCodexRuntimeState((current) => update(current));
  }, []);
  const startNew = useCallback(async () => {
    navigate(startNewConversation(locationRef.current, workspace), 'push');
  }, [navigate, workspace]);
  const selectConversation = useCallback(
    async (id: string, target: string = workspace) => {
      const parsed = conversationIdSchema.safeParse(id);
      const targetWorkspace = workspaceIdSchema.safeParse(target);
      if (!parsed.success || !targetWorkspace.success) return;
      navigate(
        showConversation(locationRef.current, {
          state: 'created',
          workspace: targetWorkspace.data,
          id: parsed.data,
        }),
        'push',
      );
    },
    [navigate, workspace],
  );
  const renameConversation = useCallback(
    async (id: string, target: string, title: string) => {
      const parsed = conversationIdSchema.safeParse(id);
      const targetWorkspace = workspaceIdSchema.safeParse(target);
      if (!parsed.success || !targetWorkspace.success) return;
      const applyTitle = (next: string) => {
        const retitle = (items: readonly AgentConversationSummary[]) =>
          items.map((item) => (item.id === parsed.data ? { ...item, title: next } : item));
        if (targetWorkspace.data === workspace) {
          setConversations(retitle);
        } else {
          setOtherWorkspaces((groups) =>
            groups.map((group) =>
              group.id === targetWorkspace.data
                ? { ...group, conversations: retitle(group.conversations) }
                : group,
            ),
          );
        }
      };
      const listed =
        targetWorkspace.data === workspace
          ? conversations
          : otherWorkspaces.find((group) => group.id === targetWorkspace.data)?.conversations;
      const previous = listed?.find((item) => item.id === parsed.data)?.title;
      // Shown at once: waiting for the round trip put the old name back on
      // screen the moment the field closed, which read as the rename not taking.
      applyTitle(title);
      try {
        const renamed = await renameConversationTitle(
          { workspace: targetWorkspace.data, conversation: parsed.data },
          title,
        );
        if (isCurrentWorkspace()) applyTitle(renamed);
      } catch (error) {
        if (!isCurrentWorkspace()) return;
        if (previous !== undefined) applyTitle(previous);
        setHistoryError(describeError(error));
      }
    },
    [conversations, isCurrentWorkspace, otherWorkspaces, workspace],
  );
  const removeConversation = useCallback(
    async (id: string) => {
      const parsed = conversationIdSchema.safeParse(id);
      if (!parsed.success) return;
      try {
        await deleteConversation({ workspace, conversation: parsed.data });
        if (!isCurrentWorkspace()) return;
        const remaining = await refreshHistory();
        if (!isCurrentWorkspace()) return;
        const current = chatAt(locationRef.current);
        if (current?.state !== 'created' || current.id !== parsed.data || remaining === null)
          return;
        const replacement = remaining[0];
        if (replacement === undefined) {
          navigate(startNewConversation(locationRef.current, workspace), 'replace');
        } else {
          const replacementId = conversationIdSchema.safeParse(replacement.id);
          if (replacementId.success) {
            navigate(
              showConversation(locationRef.current, {
                state: 'created',
                workspace,
                id: replacementId.data,
              }),
              'replace',
            );
          }
        }
      } catch (error) {
        if (isCurrentWorkspace()) setHistoryError(describeError(error));
      }
    },
    [isCurrentWorkspace, navigate, refreshHistory, workspace],
  );

  const shared: SharedAgentState = {
    workspace,
    ...(workspaceName === undefined ? {} : { workspaceName }),
    conversations,
    otherWorkspaces,
    historyLoading,
    historyError,
    modelOptions,
    catalogUnavailable,
    codexRuntime,
    setCodexRuntime,
    agentSettings,
    setAgentSettings,
    refreshHistory,
    startNew,
    selectConversation,
    renameConversation,
    removeConversation,
  };
  const close = () => navigate(closeConversation(locationRef.current), 'push');

  if (chat.state === 'draft') {
    return (
      <DraftAgent
        {...surface}
        shared={shared}
        onClose={close}
        onCreated={(id, release) => {
          if (!isCurrentWorkspace()) {
            release();
            return;
          }
          const next = finishDraft(locationRef.current, workspace, id);
          if (next === null) {
            release();
            return;
          }
          lease.current = { session: sessionKey({ workspace, conversation: id }), release };
          navigate(next, 'replace');
          void refreshHistory();
        }}
      />
    );
  }
  return (
    <CreatedAgent
      key={sessionKey({ workspace: chat.workspace, conversation: chat.id })}
      {...surface}
      shared={shared}
      session={{ workspace: chat.workspace, conversation: chat.id }}
      onClose={close}
    />
  );
}

interface SurfaceProps extends Pick<
  AgentHostProps,
  | 'selectionContext'
  | 'onClearSelectionContext'
  | 'renderMarkdown'
  | 'onOpenManagedResult'
  | 'visible'
  | 'full'
  | 'expanded'
  | 'onFold'
  | 'onToggleFull'
  | 'analyzerContext'
> {
  readonly shared: SharedAgentState;
  readonly onClose: () => void;
}

function commonViewModel(
  shared: SharedAgentState,
): Pick<
  AgentConversationViewModel,
  | 'conversations'
  | 'otherWorkspaces'
  | 'historyLoading'
  | 'historyError'
  | 'modelOptions'
  | 'catalogUnavailable'
  | 'codexRuntime'
  | 'agentSettings'
  | 'setCodexRuntime'
  | 'setAgentSettings'
  | 'selectConversation'
  | 'startConversation'
  | 'renameConversation'
  | 'removeConversation'
> {
  return {
    conversations: shared.conversations,
    otherWorkspaces: shared.otherWorkspaces,
    historyLoading: shared.historyLoading,
    historyError: shared.historyError,
    modelOptions: shared.modelOptions,
    catalogUnavailable: shared.catalogUnavailable,
    codexRuntime: shared.codexRuntime,
    agentSettings: shared.agentSettings,
    setCodexRuntime: shared.setCodexRuntime,
    setAgentSettings: shared.setAgentSettings,
    selectConversation: shared.selectConversation,
    startConversation: shared.startNew,
    renameConversation: shared.renameConversation,
    removeConversation: shared.removeConversation,
  };
}

function ExactSurface({
  shared,
  conversation,
  onClose,
  ...props
}: SurfaceProps & {
  readonly conversation: AgentConversationViewModel;
}) {
  return (
    <ConversationSurface
      workspaceId={shared.workspace}
      workspaceName={shared.workspaceName}
      conversation={conversation}
      selectionContext={props.selectionContext}
      full={props.full}
      expanded={props.expanded}
      onClose={onClose}
      onFold={props.onFold}
      onToggleFull={props.onToggleFull}
      onClearSelectionContext={props.onClearSelectionContext}
      renderMarkdown={props.renderMarkdown}
      onOpenManagedResult={props.onOpenManagedResult}
    />
  );
}

function DraftAgent({
  shared,
  analyzerContext,
  onCreated,
  ...surface
}: SurfaceProps & {
  readonly onCreated: (id: ConversationId, release: Unsubscribe) => void;
}) {
  const entryDraft = useMemo(() => readEntryDraft(shared.workspace), [shared.workspace]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [draftInsertion, setDraftInsertion] = useState({
    text: entryDraft?.prompt ?? '',
    version: entryDraft === null ? 0 : 1,
  });
  const mounted = useRef(true);
  const startingRef = useRef(false);
  const entryDraftStarted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const send = useCallback(
    async (text: string) => {
      if (startingRef.current) return;
      startingRef.current = true;
      setStarting(true);
      setError(null);
      try {
        const started = await startConversation(shared.workspace, text, {
          create: {
            codexRuntime: shared.codexRuntime,
            agentSettings: shared.agentSettings,
          },
          turn: {
            ...(analyzerContext === null ? {} : { analyzer_context: analyzerContext }),
          },
        });
        clearEntryDraft(shared.workspace);
        onCreated(started.session.conversation as ConversationId, started.release);
      } catch (failure) {
        startingRef.current = false;
        if (mounted.current) {
          setError(describeError(failure));
          setStarting(false);
          setDraftInsertion((current) => ({ text, version: current.version + 1 }));
        }
      }
    },
    [analyzerContext, onCreated, shared],
  );
  useEffect(() => {
    if (entryDraft === null || entryDraftStarted.current) return;
    entryDraftStarted.current = true;
    void send(entryDraft.prompt);
  }, [entryDraft, send]);
  const conversation: AgentConversationViewModel = {
    ...commonViewModel(shared),
    conversationId: null,
    messages: [],
    liveEvents: [],
    toolCall: '',
    streaming: false,
    interrupting: false,
    error,
    canLoadEarlier: false,
    messageStartIndex: 0,
    loadingEarlier: false,
    queued: [],
    draftInsertion,
    pendingRole: '',
    activeRole: null,
    interruptArmed: false,
    interruptedRole: '',
    lockedFamilies: null,
    agentSettingsLocked: false,
    composerFocusRequest: 0,
    sendUnavailable: starting,
    inputUnavailable: starting,
    connectionAction: null,
    loadEarlier: async () => false,
    send,
    cancel: () => undefined,
    queueMessage: () => undefined,
    discardQueued: () => undefined,
    returnQueuedToComposer: () => undefined,
    releaseResumeTarget: () => undefined,
  };
  return (
    <ExactSurface
      {...surface}
      analyzerContext={analyzerContext}
      shared={shared}
      conversation={conversation}
    />
  );
}

function CreatedAgent({
  shared,
  session,
  analyzerContext,
  ...surface
}: SurfaceProps & { readonly session: SessionRef }) {
  const { state, controller } = useSession(session, surface.visible !== false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [queued, setQueued] = useState<readonly QueuedMessage<Readonly<Record<string, unknown>>>[]>(
    [],
  );
  const queuedRef = useRef(queued);
  queuedRef.current = queued;
  const [draftInsertion, setDraftInsertion] = useState({ text: '', version: 0 });
  const [interruptArmed, setInterruptArmed] = useState(false);
  const [resumeOverride, setResumeOverride] = useState<string | null>(null);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false);
  const mounted = useRef(true);
  const result = useRef<'completed' | 'stopped' | 'failed' | null>(null);
  const previousBusy = useRef(false);
  const beforeTurnMessage = useRef<string | null>(null);
  const serverRuntime = useRef<CodexRuntimeSelection | null>(null);
  const serverSettings = useRef<AgentSettings | null>(null);
  const armedReadyCount = useRef(0);
  const role = useMemo(() => roleState(state.live), [state.live]);
  const readyCount = useMemo(
    () => state.live.filter((event) => event.kind === 'role_ready').length,
    [state.live],
  );
  const setSharedRuntime = shared.setCodexRuntime;
  const setSharedSettings = shared.setAgentSettings;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (state.codexRuntime !== null) {
      const incoming = state.codexRuntime as CodexRuntimeSelection;
      const previous = serverRuntime.current;
      setSharedRuntime((current) => reconciledRuntime(current, previous, incoming));
      serverRuntime.current = incoming;
    }
  }, [setSharedRuntime, state.codexRuntime]);
  useEffect(() => {
    if (state.agentSettings !== null) {
      const incoming = state.agentSettings;
      const previous = serverSettings.current;
      setSharedSettings((current) =>
        previous === null || JSON.stringify(current) === JSON.stringify(previous)
          ? incoming
          : current,
      );
      serverSettings.current = incoming;
    }
  }, [setSharedSettings, state.agentSettings]);

  useEffect(() => {
    const ending = terminalResult(state.live);
    if (ending !== null) {
      result.current = ending;
      const done = [...state.live].reverse().find((event) => event.kind === 'done');
      if (done?.outcome === 'request_user_input') {
        setComposerFocusRequest((current) => current + 1);
      }
    }
  }, [state.live]);

  const beginTurn = useCallback(
    async (text: string, context: Readonly<Record<string, unknown>> | null) => {
      if (commandPendingRef.current || !controller.canSend()) return false;
      commandPendingRef.current = true;
      setCommandPending(true);
      try {
        if (
          state.codexRuntime !== null &&
          shared.codexRuntime.orchestrator.model !== '' &&
          !sameRuntime(state.codexRuntime, shared.codexRuntime)
        ) {
          await updateConversationRuntime(session, shared.codexRuntime);
        }
      } catch (error) {
        if (mounted.current) setCommandError(describeError(error));
        return false;
      } finally {
        commandPendingRef.current = false;
        if (mounted.current) setCommandPending(false);
      }
      if (!mounted.current || !controller.canSend()) return false;
      result.current = null;
      setCommandError(null);
      const resumeRole = resumeOverride ?? state.interruptedRole;
      setResumeOverride(null);
      const turn = controller.send(text, {
        ...(context === null ? {} : { analyzer_context: context }),
        agent_mode: shared.agentSettings.agentMode,
        autonomous_mode: shared.agentSettings.autonomous,
        sandbox_mode: shared.agentSettings.sandbox,
        ...(resumeRole === '' ? {} : { resume_role: resumeRole }),
      });
      void turn.then(() => shared.refreshHistory());
      return true;
    },
    [controller, resumeOverride, session, shared, state.codexRuntime, state.interruptedRole],
  );
  const send = useCallback(
    async (text: string) => {
      if (await beginTurn(text, analyzerContext)) return;
      if (!mounted.current) return;
      // The input is locked while beginTurn negotiates runtime, so restoring
      // this text cannot overwrite a newer draft and does not consume a queue
      // slot that may already be at its fixed limit.
      setDraftInsertion((current) => ({ text, version: current.version + 1 }));
    },
    [analyzerContext, beginTurn],
  );
  const runQueued = useRef(beginTurn);
  runQueued.current = beginTurn;

  useEffect(() => {
    const busy = state.status === 'streaming' || state.status === 'cancelling';
    if (!previousBusy.current && busy)
      beforeTurnMessage.current = lastMessageMarker(state.messages);
    const crossedBoundary = previousBusy.current && !busy;
    previousBusy.current = busy;
    if (state.status === 'idle' && interruptArmed) setInterruptArmed(false);
    if (!crossedBoundary || state.status !== 'idle') return;
    const ending =
      result.current ?? storedTerminalResult(state.messages, beforeTurnMessage.current);
    if (ending !== 'completed') return;
    const next = queuedRef.current.find((message) => !message.suspended);
    if (next === undefined) return;
    result.current = null;
    void runQueued.current(next.text, next.context).then((started) => {
      if (started && mounted.current) {
        setQueued((current) => current.filter((message) => message.id !== next.id));
      }
    });
  }, [interruptArmed, state.messages, state.status]);

  useEffect(() => {
    if (
      !shouldSpendArmedInterrupt(
        interruptArmed,
        state.status,
        role.pendingRole,
        readyCount,
        armedReadyCount.current,
      )
    ) {
      return;
    }
    setInterruptArmed(false);
    setQueued((current) => current.map((message) => ({ ...message, suspended: true })));
    void controller.interrupt();
  }, [controller, interruptArmed, readyCount, role.pendingRole, state.status]);

  const cancel = useCallback(() => {
    if (state.status !== 'streaming') return;
    if (role.pendingRole !== '') {
      setInterruptArmed((current) => {
        if (!current) armedReadyCount.current = readyCount;
        return !current;
      });
      return;
    }
    setQueued((current) => current.map((message) => ({ ...message, suspended: true })));
    void controller.interrupt();
  }, [controller, readyCount, role.pendingRole, state.status]);
  const queueMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') return;
      setQueued((current) =>
        current.length >= MAX_QUEUED_MESSAGES
          ? current
          : [
              ...current,
              {
                id: nextQueuedMessageId(),
                text: trimmed,
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
    const message = queuedRef.current.find((candidate) => candidate.id === id);
    if (message === undefined) return;
    setQueued((current) => current.filter((candidate) => candidate.id !== id));
    setDraftInsertion((current) => ({ text: message.text, version: current.version + 1 }));
  }, []);
  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || !state.hasEarlier) return false;
    const before = controller.getState().startIndex;
    setLoadingEarlier(true);
    try {
      await controller.loadEarlier();
      return controller.getState().startIndex < before;
    } finally {
      setLoadingEarlier(false);
    }
  }, [controller, loadingEarlier, state.hasEarlier]);
  const lockedFamilies = useMemo(() => {
    if (state.messages.length === 0 || state.codexRuntime === null) return null;
    const family = (runtime: CodexRoleRuntime) =>
      runtime.provider ?? runtimeModel(shared.modelOptions, runtime)?.family ?? '';
    return {
      orchestrator: family(state.codexRuntime.orchestrator),
      implementer: family(state.codexRuntime.implementer),
      assistant: family(state.codexRuntime.assistant),
    };
  }, [shared.modelOptions, state.codexRuntime, state.messages.length]);

  const conversation: AgentConversationViewModel = {
    ...commonViewModel(shared),
    conversationId: session.conversation,
    messages: messagesForConversation(state.messages),
    liveEvents: eventsForConversation(state.live),
    toolCall: activeToolCall(state.live),
    streaming: state.status === 'streaming' || state.status === 'cancelling',
    interrupting: state.status === 'cancelling',
    error: commandError ?? state.error,
    historyLoading: shared.historyLoading || state.status === 'loading',
    canLoadEarlier: state.hasEarlier,
    messageStartIndex: state.startIndex,
    loadingEarlier,
    queued,
    draftInsertion,
    pendingRole: role.pendingRole,
    activeRole: role.activeRole,
    interruptArmed,
    interruptedRole: resumeOverride ?? state.interruptedRole,
    lockedFamilies,
    agentSettingsLocked: state.messages.length > 0,
    composerFocusRequest,
    sendUnavailable: commandPending || !controller.canSend(),
    inputUnavailable: commandPending,
    connectionAction:
      state.status === 'failed' || state.status === 'detached'
        ? {
            label: state.status === 'failed' ? 'Retry conversation' : 'Reattach conversation',
            activate: () => controller.attach(),
          }
        : null,
    loadEarlier,
    send,
    cancel,
    queueMessage,
    discardQueued,
    returnQueuedToComposer,
    releaseResumeTarget: () => setResumeOverride(''),
  };
  return (
    <ExactSurface
      {...surface}
      analyzerContext={analyzerContext}
      shared={shared}
      conversation={conversation}
    />
  );
}
