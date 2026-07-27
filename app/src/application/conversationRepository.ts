import {
  frozenCitationV1Schema,
  type AnalyzerTurnContextV1,
  type FrozenCitationV1,
} from '../domain/citation';

export interface ConversationTokens {
  read: number;
  prefill: number;
  output: number;
}

export type ConversationTurnEvent =
  | { kind: 'intermediate_output'; role: string; text: string }
  | { kind: 'decision'; action: string; task: string }
  | { kind: 'implementer'; text: string }
  | { kind: 'usage'; role: string; duration_ms: number; tokens: ConversationTokens }
  | { kind: 'final'; text: string };

export interface ConversationMessage {
  role: string;
  content: string;
  activity?: readonly ConversationTurnEvent[] | null;
  citations?: readonly FrozenCitationV1[] | null;
  citation_dictionary_id?: string | null;
  citation_dsl_version?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: readonly ConversationMessage[];
}

export interface TurnCompletion {
  text: string;
  citations: readonly FrozenCitationV1[];
  citationDictionaryId: string | null;
  citationDslVersion: string | null;
}

export interface ConversationStreamHandlers {
  progress?: (text: string) => void;
  event?: (event: ConversationTurnEvent) => void;
  done?: (completion: TurnCompletion) => void;
}

const CONVERSATION_API = '/api/conversations';

async function requireResponse(response: Response, action: string): Promise<Response> {
  if (!response.ok) throw new Error(`${action} failed (${response.status})`);
  return response;
}

export async function createConversation(): Promise<Conversation> {
  const response = await requireResponse(
    await fetch(CONVERSATION_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox: 'workspace-write', autonomous: true }),
    }),
    'Create conversation',
  );
  return response.json() as Promise<Conversation>;
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const response = await fetch(`${CONVERSATION_API}/${conversationId}?limit=100`);
  if (response.status === 404) return null;
  await requireResponse(response, 'Load conversation');
  const conversation = (await response.json()) as Conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((message) => ({
      ...message,
      citations: (message.citations ?? []).flatMap((citation) => {
        const parsed = frozenCitationV1Schema.safeParse(citation);
        return parsed.success ? [parsed.data] : [];
      }),
    })),
  };
}

export async function sendConversationTurn(
  conversationId: string,
  text: string,
  analyzerContext: AnalyzerTurnContextV1 | null,
  handlers: ConversationStreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${CONVERSATION_API}/${conversationId}/messages`, {
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
  conversationId: string,
  handlers: ConversationStreamHandlers,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetch(`${CONVERSATION_API}/${conversationId}/stream`, { signal });
  if (response.status === 409) return false;
  await consumeTurnStream(await requireResponse(response, 'Resume turn'), handlers);
  return true;
}

export async function cancelConversationTurn(conversationId: string): Promise<boolean> {
  const response = await requireResponse(
    await fetch(`${CONVERSATION_API}/${conversationId}/cancel`, { method: 'POST' }),
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
  } else if (event === 'done') {
    const text = String(data.text ?? '');
    handlers.event?.({ kind: 'final', text });
    const citations = Array.isArray(data.citations)
      ? data.citations.flatMap((citation) => {
          const parsed = frozenCitationV1Schema.safeParse(citation);
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
