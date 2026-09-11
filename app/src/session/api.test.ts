/**
 * These tests exist because the wire shapes are not guessable.
 *
 * Every fixture here is spelled the way the conversation backend spells it —
 * `workspace_id`, a numeric `ts`, `total_messages` — so that a schema which
 * drifted towards a nicer-looking name would fail here rather than in a
 * browser. That is the whole point: the names are the contract, and a test that
 * invented them would pass while the service returned something else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cancelTurn,
  createWorkspace,
  deleteConversation,
  describeError,
  getConversation,
  getWorkspace,
  listCodexBackends,
  listWorkspaces,
  SessionApiError,
  updateConversationRuntime,
} from './api';
import type { CodexRuntimeSelection, SessionRef } from './types';

const REF: SessionRef = { workspace: 'w_main', conversation: 'c1' };
const RUNTIME: CodexRuntimeSelection = {
  orchestrator: { model: 'gpt-6', effort: 'high', serviceTier: 'fast' },
  implementer: { model: 'gpt-6', effort: 'medium', serviceTier: 'default' },
  assistant: { model: 'gpt-6', effort: 'high', serviceTier: 'default' },
};

/**
 * What was asked for, and how.
 *
 * The URL alone is not the request. A `/cancel` sent as a GET reaches the same
 * address and does nothing — the backend routes it as POST — and a test that
 * recorded only the path would call that a Stop.
 */
interface Sent {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
}

let sent: Sent[];
/** The paths, in order, for the assertions that are only about addressing. */
let requested: string[];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function answer(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    requested.push(String(input));
    sent.push({
      url: String(input),
      // The default when a caller states none, which is what `fetch` does.
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : null,
    });
    return Promise.resolve(json(body, status));
  });
}

beforeEach(() => {
  requested = [];
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listWorkspaces', () => {
  it('creates a managed workspace with the backend wire body', async () => {
    answer({
      workspace_id: 'w_new',
      display_name: 'A question',
      state: 'active',
      storage_kind: 'managed',
      created_at: 10,
      last_accessed_at: 10,
      naming_state: 'pending',
    });
    await expect(createWorkspace('A question')).resolves.toMatchObject({
      id: 'w_new',
      label: 'A question',
      storageKind: 'managed',
      namingState: 'pending',
    });
    expect(sent[0]).toEqual({
      url: '/api/agent/v1/workspaces',
      method: 'POST',
      body: JSON.stringify({ displayName: 'A question', autoName: true }),
    });
  });

  it('reads the descriptor the backend actually sends', async () => {
    answer({
      workspaces: [
        {
          workspace_id: 'w_main',
          display_name: 'Main',
          state: 'active',
          storage_kind: 'local',
          created_at: 1,
          last_accessed_at: 2,
        },
      ],
    });
    await expect(listWorkspaces()).resolves.toEqual([
      {
        id: 'w_main',
        label: 'Main',
        archived: false,
        storageKind: 'external',
        createdAt: 1,
        lastAccessedAt: 2,
        namingState: 'manual',
      },
    ]);
  });

  it('falls back to the id when a workspace has no name', async () => {
    // An unnamed workspace still has to be pickable.
    answer({ workspaces: [{ workspace_id: 'w_7' }] });
    const [only] = await listWorkspaces();
    expect(only).toEqual({
      id: 'w_7',
      label: 'w_7',
      archived: false,
      storageKind: 'managed',
      createdAt: 0,
      lastAccessedAt: 0,
      namingState: 'manual',
    });
  });

  it('reads the archived flag from the state field', async () => {
    answer({ workspaces: [{ workspace_id: 'w_old', state: 'archived' }] });
    expect((await listWorkspaces())[0].archived).toBe(true);
  });
});

describe('exact Agent metadata', () => {
  it('reads one workspace through the same descriptor boundary', async () => {
    answer({ workspace_id: 'w_main', display_name: 'Main', state: 'active' });
    await expect(getWorkspace('w_main')).resolves.toEqual({
      id: 'w_main',
      label: 'Main',
      archived: false,
      storageKind: 'managed',
      createdAt: 0,
      lastAccessedAt: 0,
      namingState: 'manual',
    });
  });

  it('validates the server-owned runtime catalog', async () => {
    answer({
      models: [
        {
          id: 'gpt-6',
          label: 'GPT-6',
          family: 'gpt',
          familyLabel: 'GPT',
          efforts: ['medium', 'high'],
          defaultEffort: 'high',
          serviceTiers: ['default', 'fast'],
          defaultServiceTier: 'default',
          available: true,
        },
      ],
      defaults: RUNTIME,
    });

    await expect(listCodexBackends()).resolves.toMatchObject({
      models: [{ id: 'gpt-6', serviceTiers: ['default', 'fast'] }],
      defaults: RUNTIME,
    });
  });

  it('patches runtime and deletes a conversation at its canonical session address', async () => {
    answer({
      id: 'c1',
      title: 'Conversation',
      messages: [],
      codex_runtime: RUNTIME,
      agent_mode: 'single',
      autonomous: true,
    });
    await updateConversationRuntime(REF, RUNTIME);
    expect(sent[0]).toEqual({
      url: '/api/agent/v1/workspaces/w_main/conversations/c1/runtime',
      method: 'PATCH',
      body: JSON.stringify({ codex_runtime: RUNTIME }),
    });

    answer({ ok: true });
    await deleteConversation(REF);
    expect(sent[1]).toEqual({
      url: '/api/agent/v1/workspaces/w_main/conversations/c1',
      method: 'DELETE',
      body: null,
    });
  });
});

describe('getConversation', () => {
  it('accepts a timestamp as the number the store keeps', async () => {
    // `ts` is a REAL column. A schema expecting a string would reject every
    // message the backend has ever written.
    answer({
      id: 'c1',
      messages: [{ id: 3, role: 'assistant', content: 'hi', ts: 1757462400.25 }],
      message_page: { start_index: 0, end_index: 1, total_messages: 1, has_more: false },
    });
    const conversation = await getConversation(REF);
    expect(conversation.messages[0].ts).toBe(1757462400.25);
    expect(conversation.message_page?.total_messages).toBe(1);
  });

  it('asks for one page by absolute position', async () => {
    answer({ id: 'c1', messages: [] });
    await getConversation(REF, { limit: 50, before: 120 });
    expect(requested[0]).toContain('?limit=50&before=120');
  });

  it('escapes identifiers rather than pasting them into the path', async () => {
    answer({ id: 'c1', messages: [] });
    await getConversation({ workspace: 'w/../admin', conversation: 'c 1' });
    expect(requested[0]).toContain('w%2F..%2Fadmin');
    expect(requested[0]).toContain('c%201');
  });

  it('reports a shape it cannot read rather than returning half of it', async () => {
    answer({ id: 'c1', messages: [{ role: 'assistant' }] });
    await expect(getConversation(REF)).rejects.toBeInstanceOf(SessionApiError);
  });

  it('carries the status so a caller can tell a 409 from a 500', async () => {
    answer({ detail: 'busy' }, 409);
    await expect(getConversation(REF)).rejects.toMatchObject({ status: 409 });
  });

  it('lets go of the body of a response it is not going to read', async () => {
    // An error response still has a body, and one that is never read nor
    // cancelled holds its connection until the collector happens to run. On a
    // page that retries that is a slow leak of a small per-host budget.
    let released = false;
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              released = true;
            },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(getConversation(REF)).rejects.toBeInstanceOf(SessionApiError);
    expect(released).toBe(true);
  });
});

describe('describeError', () => {
  it('says the backend could not be reached only when it could not', () => {
    expect(describeError(new SessionApiError('failed to fetch', 0))).toContain('could not reach');
    expect(describeError(new SessionApiError('404 for /c1', 404))).toBe('404 for /c1');
  });

  it('says something useful about anything else', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('boom')).toBe('boom');
  });
});

describe('cancelTurn', () => {
  it('means whatever is running when it is given no turn', async () => {
    // What a reader pressing Stop means: the thing on screen. They have not been
    // told a turn id and should not have to be.
    answer({ cancelled: true, interrupted_role: 'planner' });
    expect(await cancelTurn(REF)).toEqual({ cancelled: true, interruptedRole: 'planner' });
    // The method as well as the address. A Stop sent as a GET reaches the same
    // URL, is not routed, and answers nothing — while the reader watches
    // `cancelling` over a turn that was never asked to stop.
    expect(sent[0]).toEqual({
      url: '/api/agent/v1/workspaces/w_main/conversations/c1/cancel',
      method: 'POST',
      body: null,
    });
  });

  it('names the turn when the caller knows which one it means', async () => {
    // The retry after a slow acknowledgement. By the time it goes out this
    // conversation may be running someone else's turn, and the name is what
    // lets the backend refuse instead of stopping that one.
    answer({ cancelled: false, stale: true });
    expect(await cancelTurn(REF, { turnId: 'a b/c' })).toEqual({
      cancelled: false,
      interruptedRole: '',
    });
    expect(requested[0]).toBe(
      '/api/agent/v1/workspaces/w_main/conversations/c1/cancel?turn_id=a%20b%2Fc',
    );
  });

  it('leaves the request unnamed when there is no name to give', async () => {
    // A backend that named no turn is not a backend to send an empty name to:
    // it would be compared against a real id and refused every time.
    answer({ cancelled: true });
    await cancelTurn(REF, { turnId: null });
    expect(requested[0]).not.toContain('turn_id');
  });
});
