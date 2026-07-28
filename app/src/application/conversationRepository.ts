import {
  frozenCitationV2Schema,
  type AnalyzerTurnContextV2,
  type FrozenCitationV2,
} from '../domain/citation';

export interface ConversationTokens {
  read: number;
  prefill: number;
  output: number;
}

export interface ConversationFailure {
  code: string;
  message: string;
}

export type ConversationTurnEvent =
  | { kind: 'intermediate_output'; role: string; text: string }
  | { kind: 'decision'; action: string; task: string }
  | { kind: 'implementer'; text: string }
  | { kind: 'usage'; role: string; duration_ms: number; tokens: ConversationTokens }
  | { kind: 'error'; text: string }
  | {
      kind: 'job';
      workspaceId: string;
      status: string;
      experimentId: string;
      experimentPath: string;
      jobId: string;
    }
  | { kind: 'final'; text: string };

export interface ConversationMessage {
  role: string;
  content: string;
  activity?: readonly ConversationTurnEvent[] | null;
  citations?: readonly FrozenCitationV2[] | null;
  citation_dictionary_id?: string | null;
  citation_dsl_version?: string | null;
  failure?: ConversationFailure | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: readonly ConversationMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated_at?: number | string;
}

interface ConversationListResponse {
  conversations?: readonly ConversationSummary[];
}

export interface TurnCompletion {
  text: string;
  citations: readonly FrozenCitationV2[];
  citationDictionaryId: string | null;
  citationDslVersion: string | null;
  failure: ConversationFailure | null;
}

export interface ConversationStreamHandlers {
  progress?: (text: string) => void;
  event?: (event: ConversationTurnEvent) => void;
  done?: (completion: TurnCompletion) => void;
}

function conversationApi(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations`;
}

async function requireResponse(response: Response, action: string): Promise<Response> {
  if (!response.ok) throw new Error(`${action} failed (${response.status})`);
  return response;
}

function conversationFailureFrom(value: unknown, legacyContent = ''): ConversationFailure | null {
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    if (typeof source.code === 'string' && typeof source.message === 'string') {
      return { code: source.code, message: source.message };
    }
  }
  if (!legacyContent.trimStart().startsWith('(backend error:')) return null;
  if (legacyContent.toLowerCase().includes('no space left on device')) {
    return {
      code: 'runtime_storage_full',
      message:
        'The Agent runtime could not start because the host disk is full. Free space, then retry this question.',
    };
  }
  return {
    code: 'agent_runtime_failure',
    message:
      'The Agent runtime failed before producing an answer. Retry the question; the full diagnostic is available in the backend log.',
  };
}

export async function createConversation(workspaceId: string): Promise<Conversation> {
  const response = await requireResponse(
    await fetch(conversationApi(workspaceId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox: 'workspace-write', autonomous: true }),
    }),
    'Create conversation',
  );
  return response.json() as Promise<Conversation>;
}

export async function listConversations(
  workspaceId: string,
): Promise<readonly ConversationSummary[]> {
  const response = await requireResponse(
    await fetch(conversationApi(workspaceId)),
    'List conversations',
  );
  const payload = (await response.json()) as ConversationListResponse;
  return Array.isArray(payload.conversations) ? payload.conversations : [];
}

export async function deleteConversation(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await requireResponse(
    await fetch(`${conversationApi(workspaceId)}/${conversationId}`, { method: 'DELETE' }),
    'Delete conversation',
  );
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const response = await fetch(`${conversationApi(workspaceId)}/${conversationId}?limit=100`);
  if (response.status === 404) return null;
  await requireResponse(response, 'Load conversation');
  const conversation = (await response.json()) as Conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      failure: conversationFailureFrom(message.failure, message.content),
      citations: (message.citations ?? []).flatMap((citation) => {
        const parsed = frozenCitationV2Schema.safeParse(citation);
        return parsed.success ? [parsed.data] : [];
      }),
    })),
  };
}

export async function sendConversationTurn(
  workspaceId: string,
  conversationId: string,
  text: string,
  analyzerContext: AnalyzerTurnContextV2 | null,
  handlers: ConversationStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${conversationApi(workspaceId)}/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      sandbox_mode: 'workspace-write',
      autonomous_mode: true,
      ...(analyzerContext ? { analyzerContext } : {}),
    }),
    signal,
  });
  await consumeTurnStream(await requireResponse(response, 'Send message'), handlers);
}

export async function resumeConversationTurn(
  workspaceId: string,
  conversationId: string,
  handlers: ConversationStreamHandlers,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetch(`${conversationApi(workspaceId)}/${conversationId}/stream`, {
    signal,
  });
  // 204 is the current idle contract; 409 remains accepted while a rolling
  // deployment may still have the previous backend version.
  if (response.status === 204 || response.status === 409) return false;
  await consumeTurnStream(await requireResponse(response, 'Resume turn'), handlers);
  return true;
}

export async function cancelConversationTurn(
  workspaceId: string,
  conversationId: string,
): Promise<boolean> {
  const response = await requireResponse(
    await fetch(`${conversationApi(workspaceId)}/${conversationId}/cancel`, { method: 'POST' }),
    'Cancel turn',
  );
  return Boolean(((await response.json()) as { cancelled?: boolean }).cancelled);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function tokensFrom(value: unknown): ConversationTokens {
  const source =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    read: numberOrZero(source.read),
    prefill: numberOrZero(source.prefill),
    output: numberOrZero(source.output),
  };
}

function eventData(chunk: string): { event: string; data: Record<string, unknown> } {
  let event = 'message';
  const dataLines: string[] = [];
  chunk.split('\n').forEach((line) => {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  });
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> };
  } catch {
    return { event, data: {} };
  }
}

function dispatchChunk(chunk: string, handlers: ConversationStreamHandlers): void {
  const { event, data } = eventData(chunk);
  if (event === 'progress') {
    handlers.progress?.(String(data.text ?? ''));
  } else if (event === 'intermediate_output') {
    handlers.event?.({
      kind: 'intermediate_output',
      role: String(data.role ?? ''),
      text: String(data.text ?? ''),
    });
  } else if (event === 'decision') {
    handlers.event?.({
      kind: 'decision',
      action: String(data.action ?? ''),
      task: String(data.task ?? ''),
    });
  } else if (event === 'implementer') {
    handlers.event?.({ kind: 'implementer', text: String(data.text ?? '') });
  } else if (event === 'usage') {
    handlers.event?.({
      kind: 'usage',
      role: String(data.role ?? ''),
      duration_ms: numberOrZero(data.duration_ms),
      tokens: tokensFrom(data.tokens),
    });
  } else if (event === 'job') {
    handlers.event?.({
      kind: 'job',
      workspaceId: String(data.workspaceId ?? ''),
      status: String(data.status ?? data.kind ?? ''),
      experimentId: String(data.experimentId ?? ''),
      experimentPath: String(data.experimentPath ?? ''),
      jobId: String(data.jobId ?? ''),
    });
  } else if (event === 'done') {
    const text = String(data.text ?? '');
    const failure = conversationFailureFrom(data.failure, text);
    handlers.event?.(failure ? { kind: 'error', text: failure.message } : { kind: 'final', text });
    const citations = Array.isArray(data.citations)
      ? data.citations.flatMap((citation) => {
          const parsed = frozenCitationV2Schema.safeParse(citation);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    handlers.done?.({
      text,
      citations,
      citationDictionaryId:
        typeof data.citation_dictionary_id === 'string' ? data.citation_dictionary_id : null,
      citationDslVersion:
        typeof data.citation_dsl_version === 'string' ? data.citation_dsl_version : null,
      failure,
    });
  }
}

async function consumeTurnStream(
  response: Response,
  handlers: ConversationStreamHandlers,
): Promise<void> {
  if (!response.body) throw new Error('Conversation stream has no response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      dispatchChunk(buffer.slice(0, boundary), handlers);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }
  if (buffer.trim()) dispatchChunk(buffer, handlers);
}
