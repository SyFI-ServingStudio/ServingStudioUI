/**
 * The conversation backend's read and command surface.
 *
 * Plain async functions over `fetch`, one per endpoint, each validating what
 * comes back. No component state, no caching, no retries: those are decisions
 * about *when* to call, and they belong to `controller.ts`.
 *
 * Addresses are built here and only here. Every identifier that becomes a path
 * segment is escaped, because workspace and conversation ids are server-issued
 * opaque strings — validated at the edge by `parseSessionRef`, escaped again
 * here so a token that slips through cannot address a different route.
 */
import { z } from 'zod';

import {
  codexModelOptionSchema,
  codexRuntimeSelectionSchema,
  conversationSchema,
  conversationSummarySchema,
  managedJobSchema,
  workspaceSchema,
  type CodexRuntimeCatalog,
  type CodexRuntimeSelection,
  type Conversation,
  type ConversationSummary,
  type ManagedJob,
  type SessionRef,
  type Workspace,
  type WorkspaceCatalog,
  type WorkspaceKind,
} from './types';

/**
 * The conversation backend, mounted beside the Analyzer.
 *
 * Relative, and the prefix names the service rather than the deployment: the
 * dev server proxies `/api/agent/v1` to the backend and production serves both
 * from one origin, so there is no host to configure and no CORS surface.
 */
const AGENT_BASE = '/api/agent/v1/';

/**
 * Raised for every failure a caller can act on.
 *
 * `status` is the HTTP status, or 0 when the request never got one — a
 * transport failure, which is the case a caller cannot distinguish from the
 * message alone and the one where "the backend said no" would be a lie.
 */
export class SessionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SessionApiError';
  }
}

/**
 * A failure in a sentence, for a reader rather than a log.
 *
 * Here rather than in each caller so that "could not reach the backend" is
 * phrased once: a transport failure reaches the UI through several paths, and
 * three spellings of it read as three different problems.
 */
export function describeError(error: unknown): string {
  if (error instanceof SessionApiError) {
    return error.status === 0
      ? `could not reach the conversation backend: ${error.message}`
      : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function conversationPath(ref: SessionRef): string {
  return `${AGENT_BASE}workspaces/${segment(ref.workspace)}/conversations/${segment(ref.conversation)}`;
}

function workspacePath(workspace: string): string {
  return `${AGENT_BASE}workspaces/${segment(workspace)}`;
}

/**
 * Every request this module and `stream.ts` make, and the one way they fail.
 *
 * Shared rather than written twice because the two callers want the same four
 * decisions and only differ in what they do with a successful response: a JSON
 * read decodes it, a stream reads it as it arrives. Written twice, the copies
 * drifted — one released the body of a failed response and the other did not —
 * and the way that shows up is a page that has retried a few times quietly
 * running out of connections.
 *
 * A successful response is returned unread, including the 2xx codes that carry
 * nothing: `204` is how the backend says a conversation is idle, and that is
 * the stream caller's business to interpret, not an error.
 */
export async function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // An abort is the caller's own doing and is rethrown as itself; wrapping it
    // as a backend failure would put "could not reach the conversation backend"
    // on a screen the reader had simply navigated away from.
    if (init.signal?.aborted) throw error;
    throw new SessionApiError(error instanceof Error ? error.message : String(error), 0);
  }
  if (response.ok) return response;
  // The body is read rather than cancelled. Either releases the connection —
  // the leak this guards against is a body left neither read nor cancelled —
  // but only reading it keeps what the backend actually said. The detail is
  // the whole message for a rejected workspace name or a branch that already
  // exists, and a bare "409 Conflict" leaves the reader nothing to act on.
  throw new SessionApiError(await failureMessage(response, url), response.status);
}

/**
 * What the backend said, when it said anything a reader can use.
 *
 * FastAPI puts the explanation in `detail`, and it is written for a person:
 * "branch already exists", "worktree workspaces are not enabled". Anything
 * else — HTML from a proxy, a truncated body, a network error mid-read — falls
 * back to the status line, because a garbled excerpt is worse than none.
 *
 * The code is kept either way. A detail alone can be as unhelpful as "gone",
 * and the number is the one part of a failure that is always worth reporting.
 */
async function failureMessage(response: Response, url: string): Promise<string> {
  const status = `${response.status} ${response.statusText} for ${url}`;
  let detail: unknown;
  try {
    detail = ((await response.json()) as { detail?: unknown } | null)?.detail;
  } catch {
    return status;
  }
  return typeof detail === 'string' && detail.trim()
    ? `${detail.trim()} (${response.status})`
    : status;
}

/**
 * One wire descriptor, as the browser names a workspace.
 *
 * Written once. The three call sites that each had their own copy drifted
 * apart the moment a field was added, and the failure is silent: a workspace
 * listed with one shape and fetched with another.
 */
function toWorkspace(descriptor: z.infer<typeof workspaceSchema>): Workspace {
  const storageKind =
    descriptor.storage_kind === 'external' || descriptor.storage_kind === 'local'
      ? 'external'
      : 'managed';
  // Derived, not required. A backend that predates the kind axis still
  // describes both facts, just indirectly: a copy is managed and a real git
  // tree is not. Reading them this way is what lets this build ship first.
  const kind = descriptor.workspace_kind ?? (storageKind === 'managed' ? 'copy' : 'checkout');
  return {
    id: descriptor.workspace_id,
    label: descriptor.display_name ?? descriptor.workspace_id,
    archived: descriptor.state === 'archived',
    storageKind,
    kind,
    // A backend that names the kind also names where it runs, so the fallback
    // here only ever applies to one that has neither — and such a backend runs
    // every workspace in a container, external ones included. Deriving `host`
    // from `checkout` would put a false "not sandboxed" warning on that screen.
    execution: descriptor.execution ?? 'container',
    branch: descriptor.worktree_branch ?? null,
    createdAt: descriptor.created_at ?? 0,
    lastAccessedAt: descriptor.last_accessed_at ?? descriptor.created_at ?? 0,
    namingState: descriptor.naming_state ?? 'manual',
  };
}

async function readJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(url, init);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    const where = parsed.error.issues[0];
    throw new SessionApiError(
      `${url} returned a shape this build does not read: ${where?.path.join('.') || '<root>'} ${where?.message ?? ''}`,
      response.status,
    );
  }
  return parsed.data;
}

/**
 * The workspaces this backend serves.
 *
 * The wire names are converted here, in one place, so nothing above this module
 * has to know that a workspace calls itself `workspace_id`. A descriptor with
 * no `display_name` falls back to its id rather than to an empty label: an
 * unnamed workspace still has to be pickable.
 */
export async function listWorkspaces(signal?: AbortSignal): Promise<WorkspaceCatalog> {
  const body = await readJson(
    `${AGENT_BASE}workspaces`,
    z.object({
      workspaces: z.array(workspaceSchema),
      // Optional, and the difference between absent and empty is the point: a
      // backend from before the axis says nothing, one with the feature off
      // says so with a list that omits `worktree`. Collapsing them would make
      // the picker either hide a switched-off feature or offer a missing one.
      capabilities: z
        .object({ workspaceKinds: z.array(z.enum(['copy', 'worktree', 'checkout'])) })
        .partial()
        .passthrough()
        .nullish(),
    }),
    { signal },
  );
  return {
    workspaces: body.workspaces.map(toWorkspace),
    kinds: body.capabilities?.workspaceKinds ?? null,
  };
}

/** Lifecycle rows that have not necessarily appeared in the Analyzer catalog yet. */
export async function listManagedJobs(signal?: AbortSignal): Promise<readonly ManagedJob[]> {
  const body = await readJson(`${AGENT_BASE}jobs`, z.object({ jobs: z.array(managedJobSchema) }), {
    signal,
  });
  return body.jobs.map((job) => ({
    workspaceId: job.workspace_id,
    jobId: job.job_id,
    conversationId: job.conversation_id,
    conversationTitle: job.conversation_title,
    resourceId: job.resource_id,
    analyzerResourceId: job.analyzer_resource_id,
    jobKind: job.job_kind,
    status: job.status,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  }));
}

export async function getWorkspace(workspace: string, signal?: AbortSignal): Promise<Workspace> {
  const descriptor = await readJson(workspacePath(workspace), workspaceSchema, { signal });
  return toWorkspace(descriptor);
}

/**
 * Create the workspace selected by the catalog's new-conversation flow.
 *
 * `kind` is only sent when it is asked for. A copy is what every backend makes
 * by default, so omitting the field keeps this callable against one that does
 * not know the word — and the picker only offers `worktree` to a backend that
 * has announced it.
 *
 * Branch and base are the server's to choose. It answers with the branch it
 * actually used, and that is the name the UI shows: deriving a second one here
 * would eventually disagree with the repository.
 */
export async function createWorkspace(
  displayName: string,
  options: { kind?: WorkspaceKind; branch?: string; signal?: AbortSignal } = {},
): Promise<Workspace> {
  const branch = options.branch?.trim();
  const descriptor = await readJson(`${AGENT_BASE}workspaces`, workspaceSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName,
      autoName: true,
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      // An empty box is not a request for a branch called "". Omitting the key
      // is how the caller says "you name it", and the server then picks a free
      // name instead of refusing an invalid ref.
      ...(branch ? { branch } : {}),
    }),
    signal: options.signal,
  });
  return toWorkspace(descriptor);
}

/** Server-owned model choices; a picker must never invent a model or effort. */
export async function listCodexBackends(signal?: AbortSignal): Promise<CodexRuntimeCatalog> {
  return readJson(
    `${AGENT_BASE}codex-backends`,
    z.object({
      models: z.array(codexModelOptionSchema),
      defaults: codexRuntimeSelectionSchema,
    }),
    { signal },
  );
}

export async function listConversations(
  workspace: string,
  signal?: AbortSignal,
): Promise<readonly ConversationSummary[]> {
  const body = await readJson(
    `${workspacePath(workspace)}/conversations`,
    z.object({ conversations: z.array(conversationSummarySchema) }),
    { signal },
  );
  return body.conversations;
}

/**
 * Read a conversation, or one page of it backwards.
 *
 * Omitting `limit` asks for the whole history, which is the backend's original
 * contract and what a short conversation should use. `before` is the absolute
 * position of the oldest message already held, so paging is a single number and
 * never a page count that could drift as the conversation grows.
 */
export async function getConversation(
  ref: SessionRef,
  page?: { limit: number; before?: number },
  signal?: AbortSignal,
): Promise<Conversation> {
  const query =
    page === undefined
      ? ''
      : `?limit=${page.limit}${page.before === undefined ? '' : `&before=${page.before}`}`;
  return readJson(`${conversationPath(ref)}${query}`, conversationSchema, { signal });
}

export async function createConversation(
  workspace: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ConversationSummary> {
  return readJson(`${workspacePath(workspace)}/conversations`, conversationSummarySchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export async function updateConversationRuntime(
  ref: SessionRef,
  codexRuntime: CodexRuntimeSelection,
  signal?: AbortSignal,
): Promise<Conversation> {
  return readJson(`${conversationPath(ref)}/runtime`, conversationSchema, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codex_runtime: codexRuntime }),
    signal,
  });
}

export async function deleteConversation(ref: SessionRef, signal?: AbortSignal): Promise<void> {
  await readJson(conversationPath(ref), z.object({ ok: z.boolean() }), {
    method: 'DELETE',
    signal,
  });
}

/**
 * Ask the backend to stop the running turn, and wait for it to say it did.
 *
 * This is not `detach`. Cancelling ends work on the server and is confirmed by
 * the response; detaching only stops this browser listening. Merging them would
 * make closing a panel kill a turn the user wanted to keep — or leave a
 * runaway turn running because a tab was closed.
 */
export async function cancelTurn(
  ref: SessionRef,
  options: { turnId?: string | null; signal?: AbortSignal } = {},
): Promise<{ cancelled: boolean; interruptedRole: string }> {
  // Named, or not. `/cancel` addresses the conversation, so an unnamed request
  // means "whatever is running" — which is what a reader pressing Stop means,
  // and is the only thing a caller who has not yet been told a turn id can ask
  // for. A caller that *does* know which turn it means says so, and the backend
  // refuses rather than substituting: see `cancel_message` in `backend/app.py`.
  const named = options.turnId ?? null;
  const query = named === null ? '' : `?turn_id=${encodeURIComponent(named)}`;
  const body = await readJson(
    `${conversationPath(ref)}/cancel${query}`,
    z.object({ cancelled: z.boolean().optional(), interrupted_role: z.string().optional() }),
    { method: 'POST', signal: options.signal },
  );
  return {
    cancelled: body.cancelled === true,
    interruptedRole: body.interrupted_role ?? '',
  };
}
