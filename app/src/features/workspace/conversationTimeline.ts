import type {
  ConversationTokens,
  ConversationTurnEvent,
} from '../../application/conversationRepository';

export type ConversationRole = 'orchestrator' | 'implementer';

export type ConversationCard =
  | {
      type: 'role';
      role: ConversationRole;
      round: number;
      notes: string[];
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
    }
  | { type: 'error'; text: string }
  | { type: 'answer'; text: string };

function roleFrom(value: string): ConversationRole {
  return value === 'implementer' ? 'implementer' : 'orchestrator';
}

function cleanNote(text: string): string {
  const stripped = text.trim();
  if (!stripped.startsWith('{') || !stripped.endsWith('}')) return text;
  try {
    const payload = JSON.parse(stripped) as Record<string, unknown>;
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim();
    }
    if ('action' in payload || 'task' in payload) return '';
  } catch {
    return text;
  }
  return text;
}

export function conversationCards(
  events: readonly ConversationTurnEvent[],
): readonly ConversationCard[] {
  const cards: ConversationCard[] = [];
  const lastJobEventByExperiment = new Map<string, number>();
  events.forEach((event, eventIndex) => {
    if (event.kind !== 'job') return;
    // One experiment can have several Launcher jobs when an agent extends a
    // sweep. The chat surface owns one lifecycle card for that experiment.
    const lifecycleKey = event.experimentId || event.jobId;
    lastJobEventByExperiment.set(lifecycleKey, eventIndex);
  });
  const rounds: Record<ConversationRole, number> = { orchestrator: 0, implementer: 0 };
  let current: Extract<ConversationCard, { type: 'role' }> | null = null;
  const openRole = (role: ConversationRole) => {
    rounds[role] += 1;
    const card: Extract<ConversationCard, { type: 'role' }> = {
      type: 'role',
      role,
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
      const note = cleanNote(event.text);
      if (!note) return;
      const role = roleFrom(event.role);
      const target = current?.role === role && !current.done ? current : openRole(role);
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
              ) ?? openRole(role));
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
      const lifecycleKey = event.experimentId || event.jobId;
      if (lastJobEventByExperiment.get(lifecycleKey) === eventIndex) {
        cards.push({
          type: 'job',
          workspaceId: event.workspaceId,
          experimentId: event.experimentId,
          experimentPath: event.experimentPath,
          status: event.status,
        });
      }
      current = null;
    } else if (event.kind === 'error') {
      cards.push({ type: 'error', text: event.text });
      current = null;
    } else if (event.kind === 'final') {
      cards.push({ type: 'answer', text: event.text });
      current = null;
    }
  });
  return cards;
}
