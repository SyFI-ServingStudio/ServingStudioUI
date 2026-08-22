import type {
  CodexRoleRuntime,
  AgentTerminalOutcome,
  CommentaryLevel,
  ConversationTokens,
  ConversationTurnEvent,
} from '../../application/conversationRepository';

export type ConversationRole = 'orchestrator' | 'implementer';
export interface ConversationNote {
  level: CommentaryLevel;
  text: string;
}

export type ConversationCard =
  | {
      type: 'role';
      role: ConversationRole;
      runtime?: CodexRoleRuntime;
      round: number;
      notes: ConversationNote[];
      durationMs: number | null;
      tokens: ConversationTokens | null;
      done: boolean;
    }
  | { type: 'handoff'; variant: 'delegated-task' | 'conclusion'; text: string }
  | {
      type: 'job';
      workspaceId: string;
      experimentId: string;
      experimentPath: string;
      status: string;
      jobId?: string;
      jobKind?: string;
      resourceId?: string;
      analyzerResourceId?: string;
      artifactPath?: string;
      descriptor?: Record<string, unknown>;
      summary?: Record<string, unknown> | null;
    }
  | { type: 'error'; text: string }
  | { type: 'response'; text: string; outcome: AgentTerminalOutcome };

type JobEvent = Extract<ConversationTurnEvent, { kind: 'job' }>;

function jobLifecycleKey(event: JobEvent): string {
  return event.resourceId || event.experimentId || event.jobId;
}

function roleFrom(value: string): ConversationRole {
  return value === 'implementer' ? 'implementer' : 'orchestrator';
}

function cleanNote(text: string, level?: CommentaryLevel): ConversationNote | null {
  const stripped = text.trim();
  if (!stripped.startsWith('{') || !stripped.endsWith('}')) {
    return { text, level: level ?? 'progress' };
  }
  try {
    const payload = JSON.parse(stripped) as Record<string, unknown>;
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return {
        text: payload.message.trim(),
        level: payload.action === 'milestone' ? 'milestone' : (level ?? 'progress'),
      };
    }
    if ('action' in payload || 'task' in payload) return null;
  } catch {
    return { text, level: level ?? 'progress' };
  }
  return { text, level: level ?? 'progress' };
}

export function conversationCards(
  events: readonly ConversationTurnEvent[],
): readonly ConversationCard[] {
  const cards: ConversationCard[] = [];
  const jobLifecycleByKey = new Map<string, { firstEventIndex: number; latestEvent: JobEvent }>();
  events.forEach((event, eventIndex) => {
    if (event.kind !== 'job') return;
    // One experiment can have several Launcher jobs when an agent extends a
    // sweep. Keep that lifecycle card where the experiment first appeared,
    // while replacing its contents with the newest state. Rendering at the
    // newest event would move every completed/interrupted experiment to the end
    // of the turn and invalidate the progress rail's card-index anchors.
    const lifecycleKey = jobLifecycleKey(event);
    const lifecycle = jobLifecycleByKey.get(lifecycleKey);
    jobLifecycleByKey.set(lifecycleKey, {
      firstEventIndex: lifecycle?.firstEventIndex ?? eventIndex,
      latestEvent: event,
    });
  });
  const rounds: Record<ConversationRole, number> = { orchestrator: 0, implementer: 0 };
  let current: Extract<ConversationCard, { type: 'role' }> | null = null;
  const runtimeFrom = (event: { model?: string; effort?: string }): CodexRoleRuntime | null =>
    event.model
      ? { model: event.model, effort: event.effort ?? '', serviceTier: 'default' }
      : null;
  const openRole = (role: ConversationRole, runtime?: CodexRoleRuntime | null) => {
    rounds[role] += 1;
    const card: Extract<ConversationCard, { type: 'role' }> = {
      type: 'role',
      role,
      ...(runtime ? { runtime } : {}),
      round: rounds[role],
      notes: [],
      durationMs: null,
      tokens: null,
      done: false,
    };
    cards.push(card);
    current = card;
    return card;
  };
  events.forEach((event, eventIndex) => {
    if (event.kind === 'intermediate_output') {
      const note = cleanNote(event.text, event.level);
      if (!note) return;
      const role = roleFrom(event.role);
      const target =
        current?.role === role && !current.done ? current : openRole(role, runtimeFrom(event));
      const eventRuntime = runtimeFrom(event);
      if (eventRuntime) target.runtime = eventRuntime;
      target.notes.push(note);
      current = target;
    } else if (event.kind === 'usage') {
      const role = roleFrom(event.role);
      const target =
        current?.role === role && !current.done
          ? current
          : ([...cards]
              .reverse()
              .find(
                (card): card is Extract<ConversationCard, { type: 'role' }> =>
                  card.type === 'role' && card.role === role && !card.done,
              ) ?? openRole(role, runtimeFrom(event)));
      const usageRuntime = runtimeFrom(event);
      if (usageRuntime) target.runtime = usageRuntime;
      target.durationMs = event.duration_ms;
      target.tokens = event.tokens;
      target.done = true;
      if (current === target) current = null;
    } else if (event.kind === 'decision') {
      cards.push({ type: 'handoff', variant: 'delegated-task', text: event.task });
      current = null;
    } else if (event.kind === 'implementer') {
      cards.push({ type: 'handoff', variant: 'conclusion', text: event.text });
      current = null;
    } else if (event.kind === 'job') {
      const lifecycle = jobLifecycleByKey.get(jobLifecycleKey(event));
      if (lifecycle?.firstEventIndex === eventIndex) {
        const latestEvent = lifecycle.latestEvent;
        cards.push({
          type: 'job',
          workspaceId: latestEvent.workspaceId,
          experimentId: latestEvent.experimentId,
          experimentPath: latestEvent.experimentPath,
          status: latestEvent.status,
          ...(latestEvent.jobKind
            ? {
                jobId: latestEvent.jobId,
                jobKind: latestEvent.jobKind,
                resourceId: latestEvent.resourceId,
                ...(latestEvent.analyzerResourceId
                  ? { analyzerResourceId: latestEvent.analyzerResourceId }
                  : {}),
                artifactPath: latestEvent.artifactPath,
                descriptor: latestEvent.descriptor,
                summary: latestEvent.summary,
              }
            : {}),
        });
      }
      current = null;
    } else if (event.kind === 'error') {
      cards.push({ type: 'error', text: event.text });
      current = null;
    } else if (event.kind === 'final') {
      cards.push({
        type: 'response',
        text: event.text,
        outcome: event.outcome ?? 'final_answer',
      });
      current = null;
    }
  });
  return cards;
}
