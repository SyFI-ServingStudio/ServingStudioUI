/**
 * Canonical session records as the exact conversation surface reads them.
 *
 * `session/` deliberately accepts an open event vocabulary so a future backend
 * event cannot make an entire stored conversation unreadable. The existing
 * transcript deliberately accepts a closed vocabulary because every admitted
 * event has a concrete card and interaction. This file is the boundary between
 * those two contracts: it keeps every event the transcript knows and ignores
 * only events for which that transcript has no representation.
 */
import type { Citation, StoredMessage, TurnEvent } from '../../session/types';
import { agentV1EvidenceRefSchema } from '../../session/evidenceRef';
import type {
  AgentCitation,
  AgentTerminalOutcome,
  CommentaryLevel,
  ConversationMessage,
  ConversationTokens,
  ConversationTurnEvent,
} from './agentTypes';

function stringField(value: Record<string, unknown>, name: string): string | null {
  const field = value[name];
  return typeof field === 'string' ? field : null;
}

function recordField(value: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const field = value[name];
  return field !== null && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null;
}

function commentaryLevel(value: unknown): CommentaryLevel | undefined {
  return value === 'progress' || value === 'milestone' ? value : undefined;
}

function terminalOutcome(value: unknown): AgentTerminalOutcome | undefined {
  return value === 'final_answer' || value === 'request_user_input' || value === 'cancelled'
    ? value
    : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function tokensOf(value: unknown): ConversationTokens {
  const tokens =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    read: numberOrZero(tokens.read),
    prefill: numberOrZero(tokens.prefill),
    output: numberOrZero(tokens.output),
  };
}

function eventFailureMessage(source: Record<string, unknown>, text: string): string | null {
  const failure = recordField(source, 'failure');
  const recorded = failure === null ? null : stringField(failure, 'message');
  if (recorded !== null) return recorded;
  if (!text.trimStart().startsWith('(backend error:')) return null;
  return text.toLowerCase().includes('no space left on device')
    ? 'The Agent runtime could not start because the host disk is full. Free space, then retry this question.'
    : 'The Agent runtime failed before producing an answer. Retry the question; the full diagnostic is available in the backend log.';
}

/** One open session event, when the exact transcript has a card for it. */
export function eventForConversation(event: TurnEvent): ConversationTurnEvent | null {
  const source = event as Record<string, unknown>;
  const text = event.text ?? '';
  switch (event.kind) {
    case 'intermediate_output': {
      const level = commentaryLevel(event.level) ?? 'progress';
      return {
        kind: 'intermediate_output',
        role: event.role ?? '',
        ...(stringField(source, 'model')
          ? { model: stringField(source, 'model') ?? undefined }
          : {}),
        ...(stringField(source, 'effort')
          ? { effort: stringField(source, 'effort') ?? undefined }
          : {}),
        level,
        text,
      };
    }
    case 'usage': {
      return {
        kind: 'usage',
        role: event.role ?? '',
        ...(stringField(source, 'model')
          ? { model: stringField(source, 'model') ?? undefined }
          : {}),
        ...(stringField(source, 'effort')
          ? { effort: stringField(source, 'effort') ?? undefined }
          : {}),
        duration_ms: numberOrZero(event.duration_ms),
        tokens: tokensOf(source.tokens),
      };
    }
    case 'role_start':
      return { kind: 'role_start', role: event.role ?? '' };
    case 'decision':
      return { kind: 'decision', action: event.action ?? '', task: event.task ?? '' };
    case 'implementer':
      return { kind: 'implementer', text };
    case 'job': {
      const workspaceId = stringField(source, 'workspaceId') ?? '';
      const status = stringField(source, 'status') ?? '';
      const experimentId = stringField(source, 'experimentId') ?? '';
      const experimentPath = stringField(source, 'experimentPath') ?? '';
      const jobId = stringField(source, 'jobId') ?? '';
      const jobKind = stringField(source, 'jobKind');
      const resourceId = stringField(source, 'resourceId');
      const analyzerResourceId = stringField(source, 'analyzerResourceId');
      const artifactPath = stringField(source, 'artifactPath');
      const descriptor = recordField(source, 'descriptor');
      const summary = source.summary === null ? null : recordField(source, 'summary');
      return {
        kind: 'job',
        workspaceId,
        status,
        experimentId,
        experimentPath,
        jobId,
        ...(jobKind === null ? {} : { jobKind }),
        ...(resourceId === null ? {} : { resourceId }),
        ...(analyzerResourceId === null ? {} : { analyzerResourceId }),
        ...(artifactPath === null ? {} : { artifactPath }),
        ...(descriptor === null ? {} : { descriptor }),
        ...(source.summary === null || summary !== null ? { summary } : {}),
      };
    }
    case 'error':
      return { kind: 'error', text };
    case 'final': {
      const outcome = terminalOutcome(event.outcome);
      return { kind: 'final', text, ...(outcome === undefined ? {} : { outcome }) };
    }
    case 'done': {
      const failure = eventFailureMessage(source, text);
      if (failure !== null) return { kind: 'error', text: failure };
      return {
        kind: 'final',
        text,
        outcome: terminalOutcome(event.outcome) ?? 'final_answer',
      };
    }
    default:
      return null;
  }
}

export function eventsForConversation(events: readonly TurnEvent[]): ConversationTurnEvent[] {
  return events.flatMap((event) => {
    const projected = eventForConversation(event);
    return projected === null ? [] : [projected];
  });
}

function citationForConversation(citation: Citation): AgentCitation | null {
  const target = agentV1EvidenceRefSchema.safeParse(citation.target);
  if (
    citation.protocol !== 'vibesim.citation/v2' ||
    typeof citation.sourceStart !== 'number' ||
    typeof citation.sourceEnd !== 'number' ||
    citation.sourceEnd <= citation.sourceStart ||
    citation.displayLabel == null ||
    !target.success
  ) {
    return null;
  }
  return {
    protocol: citation.protocol,
    token: citation.token,
    sourceStart: citation.sourceStart,
    sourceEnd: citation.sourceEnd,
    displayLabel: citation.displayLabel,
    target: target.data,
  };
}

/** The answer text stored by older clients included its narration wrappers. */
function legacyAssistantContent(source: string): string {
  let text = source
    .replace(/<details\s+class=["']role-output orchestrator["'][\s\S]*?<\/details>\s*/gi, '')
    .trimStart();
  if (text.startsWith('### Orchestrator')) {
    const markers = [
      { marker: '\n\n### Implementer Summary\n\n', keepHeading: true },
      { marker: '\n\n### Message\n\n', keepHeading: false },
      { marker: '\n\n### Error\n\n', keepHeading: true },
    ];
    const match = markers
      .map((candidate) => ({ ...candidate, index: text.indexOf(candidate.marker) }))
      .filter((candidate) => candidate.index >= 0)
      .sort((left, right) => left.index - right.index)[0];
    if (match) {
      text = match.keepHeading
        ? text.slice(match.index + 2)
        : text.slice(match.index + match.marker.length);
    }
  }
  if (text.startsWith('### Message\n\n')) text = text.slice('### Message\n\n'.length);
  return text.trimStart();
}

function recoveredActivity(message: StoredMessage, content: string): ConversationTurnEvent[] {
  const recovered = (message.intermediate_outputs ?? []).flatMap((output) => {
    const text = output.text ?? '';
    if (text === '') return [];
    const level = commentaryLevel(output.level);
    return [
      {
        kind: 'intermediate_output' as const,
        role: output.role ?? 'orchestrator',
        ...(level === undefined ? {} : { level }),
        text,
      },
    ];
  });
  return [...recovered, { kind: 'final', text: content, outcome: 'final_answer' }];
}

function failureMessage(message: StoredMessage): string | null {
  const rawFailure = (message as Record<string, unknown>).failure;
  if (rawFailure !== null && typeof rawFailure === 'object' && !Array.isArray(rawFailure)) {
    const recorded = stringField(rawFailure as Record<string, unknown>, 'message');
    if (recorded !== null) return recorded;
  }
  if (!message.content.trimStart().startsWith('(backend error:')) return null;
  return message.content.toLowerCase().includes('no space left on device')
    ? 'The Agent runtime could not start because the host disk is full. Free space, then retry this question.'
    : 'The Agent runtime failed before producing an answer. Retry the question; the full diagnostic is available in the backend log.';
}

/** One stored message without weakening the transcript's closed event contract. */
export function messageForConversation(message: StoredMessage): ConversationMessage {
  const content =
    message.role === 'assistant' ? legacyAssistantContent(message.content) : message.content;
  const recordedActivity = message.activity ?? [];
  // A stored turn is over. A role that started and never reported usage — a
  // cancelled call — must not come back as a card that is still working.
  const activity = eventsForConversation(recordedActivity).filter(
    (event) => event.kind !== 'role_start',
  );
  const citations = (message.citations ?? []).flatMap((citation) => {
    const projected = citationForConversation(citation);
    return projected === null ? [] : [projected];
  });
  const failure = failureMessage(message);
  return {
    role: message.role,
    content,
    activity:
      recordedActivity.length > 0
        ? activity
        : message.role === 'assistant'
          ? recoveredActivity(message, content)
          : [],
    citations,
    ...(failure === null ? {} : { failure: { message: failure } }),
  };
}

export function messagesForConversation(messages: readonly StoredMessage[]): ConversationMessage[] {
  return messages.map(messageForConversation);
}

/** The compact live-tool line is separate from the richer timeline cards. */
export function activeToolCall(events: readonly TurnEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.kind === 'tool_call' && event.text) return event.text;
  }
  return '';
}
