/**
 * What a conversation is, on the wire and in the browser.
 *
 * The schemas are the source of truth and the types are inferred from them,
 * because every value here crosses a process boundary — either from the
 * conversation backend's HTTP responses or from its event stream — and must be
 * validated rather than cast.
 *
 * Two facts shape this module.
 *
 * 1. **A stored conversation is history.** It was written when the turn ran and
 *    cannot be regenerated, so this reads what the backend wrote rather than
 *    asking the backend to rewrite it. Every optional field below is optional
 *    because some stored message predates it.
 * 2. **An event is not a message.** The stream carries the *making* of an
 *    answer — roles starting, tools running, the model narrating — and the
 *    message is what survives it. Collapsing the two would mean either
 *    persisting noise or losing the live view, so they are separate types and
 *    `projection.ts` is the one place that relates them.
 */
import { z } from 'zod';

// From `location/types` rather than the barrel: the barrel also exports the
// navigation hook, so importing it here would make this module — which must not
// know React exists — load React.
import { conversationIdSchema, workspaceIdSchema } from '../location/types';

/** A conversation, addressed. The pair is the controller's identity too. */
export interface SessionRef {
  readonly workspace: string;
  readonly conversation: string;
}

export function sessionKey(ref: SessionRef): string {
  return `${ref.workspace}/${ref.conversation}`;
}

const text = z.string();
const nonEmpty = z.string().min(1);

export const codexServiceTierSchema = z.enum(['default', 'fast']);
export type CodexServiceTier = z.infer<typeof codexServiceTierSchema>;

export const codexRoleRuntimeSchema = z
  .object({
    model: text,
    effort: text,
    serviceTier: codexServiceTierSchema,
  })
  .strict();
export type CodexRoleRuntime = z.infer<typeof codexRoleRuntimeSchema>;

export const codexRuntimeSelectionSchema = z
  .object({
    orchestrator: codexRoleRuntimeSchema,
    implementer: codexRoleRuntimeSchema,
    assistant: codexRoleRuntimeSchema,
  })
  .strict();
export type CodexRuntimeSelection = z.infer<typeof codexRuntimeSelectionSchema>;

export const agentModeSchema = z.enum(['orchestrated', 'single']);
export type AgentMode = z.infer<typeof agentModeSchema>;
export const sandboxModeSchema = z.enum(['read-only', 'workspace-write', 'danger-full-access']);
export type SandboxMode = z.infer<typeof sandboxModeSchema>;

export interface AgentSettings {
  readonly sandbox: SandboxMode;
  readonly agentMode: AgentMode;
  readonly autonomous: boolean;
}

export const codexModelOptionSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    family: nonEmpty,
    familyLabel: nonEmpty,
    efforts: z.array(nonEmpty),
    defaultEffort: text,
    serviceTiers: z.array(codexServiceTierSchema),
    defaultServiceTier: codexServiceTierSchema,
    available: z.boolean(),
  })
  .passthrough();
export type CodexModelOption = z.infer<typeof codexModelOptionSchema>;

export interface CodexRuntimeCatalog {
  readonly models: readonly CodexModelOption[];
  readonly defaults: CodexRuntimeSelection;
}

/**
 * One recorded step of a turn.
 *
 * `kind` is open — a `z.string()` rather than an enum — because the backend's
 * vocabulary grows and a stored conversation may contain a kind this build has
 * never seen. Rejecting the whole conversation over one unknown step would
 * destroy readable history to enforce a list; `projection.ts` renders what it
 * knows and passes the rest through as opaque.
 *
 * Every field is `nullish`, not `optional`. The backend writes `null` for "not
 * applicable" — `outcome` is null on a failed turn, `role` is null on a session
 * event — and with `optional` alone the *whole frame* is rejected. That is the
 * worst possible failure: the frame it costs most often is `done`, the one that
 * says the turn ended.
 */
export const turnEventSchema = z
  .object({
    kind: nonEmpty,
    role: text.nullish(),
    text: text.nullish(),
    action: text.nullish(),
    task: text.nullish(),
    model: text.nullish(),
    effort: text.nullish(),
    level: text.nullish(),
    outcome: text.nullish(),
    duration_ms: z.number().finite().nonnegative().nullish(),
  })
  .passthrough();
export type TurnEvent = z.infer<typeof turnEventSchema>;

/**
 * A frozen citation, as the backend stored it.
 *
 * `target` stays `unknown` here: `session/evidenceRef.ts` owns the
 * evidence protocol and translating it, and duplicating that shape would make
 * two places that must agree about what a citation points at.
 */
export const citationSchema = z
  .object({
    protocol: nonEmpty,
    token: nonEmpty,
    displayLabel: text.nullish(),
    sourceStart: z.number().int().nonnegative().nullish(),
    sourceEnd: z.number().int().nonnegative().nullish(),
    target: z.unknown(),
  })
  .passthrough();
export type Citation = z.infer<typeof citationSchema>;

/**
 * A stored message.
 *
 * `id` is the backend's own row id, published since schema 8. It is stable —
 * the store is append-only and its one migration is lossless — which is what
 * lets the browser key a list by identity instead of by array position, so an
 * earlier page loading above does not reorder what is already on screen.
 *
 * `turnId` anchors an assistant message to the turn that produced it, and is
 * absent on every message written before that column existed. Absent means
 * "unknown", never "none": inventing one would be inventing history.
 */
export const messageSchema = z
  .object({
    id: z.number().int().nonnegative().optional(),
    turn_id: nonEmpty.nullish(),
    role: nonEmpty,
    content: text,
    /** Seconds since the epoch, as a number: the column is `REAL`. */
    ts: z.number().finite().nullish(),
    activity: z.array(turnEventSchema).nullish(),
    /**
     * The pre-`activity` spelling of the same thing. Messages stored before the
     * activity column existed carry their narration here, and it is the only
     * record of what those turns did.
     */
    intermediate_outputs: z
      .array(
        z
          .object({ role: text.nullish(), level: text.nullish(), text: text.nullish() })
          .passthrough(),
      )
      .nullish(),
    citations: z.array(citationSchema).nullish(),
  })
  .passthrough();
export type StoredMessage = z.infer<typeof messageSchema>;

/**
 * A page of history, spelled as the store spells it.
 *
 * `start_index` is an absolute position in the conversation, not an offset into
 * this page, so paging backwards is a single number the caller passes straight
 * back as `before`. The store is append-only, so that position stays valid.
 *
 * The field is `total_messages`, not `total`. Names on this side of the wire
 * are the backend's names — inventing a tidier one here would make every paged
 * read fail validation, and it would fail at the schema rather than anywhere
 * that could explain why.
 */
export const messagePageSchema = z
  .object({
    start_index: z.number().int().nonnegative(),
    end_index: z.number().int().nonnegative(),
    total_messages: z.number().int().nonnegative(),
    has_more: z.boolean(),
  })
  .passthrough();

export const conversationSchema = z
  .object({
    id: nonEmpty,
    title: text.nullish(),
    naming_state: text.nullish(),
    codex_runtime: codexRuntimeSelectionSchema.nullish(),
    agent_mode: agentModeSchema.nullish(),
    sandbox: sandboxModeSchema.nullish(),
    autonomous: z.boolean().nullish(),
    messages: z.array(messageSchema),
    message_page: messagePageSchema.optional(),
    interrupted_role: text.nullish(),
  })
  .passthrough();
export type Conversation = z.infer<typeof conversationSchema>;

/** One row of a workspace's conversation list. `updated_at` is a REAL column. */
export const conversationSummarySchema = z
  .object({
    id: nonEmpty,
    title: text.nullish(),
    naming_state: text.nullish(),
    updated_at: z.number().finite().nullish(),
  })
  .passthrough();
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

/**
 * A workspace descriptor, as the registry writes it.
 *
 * `workspace_id`/`display_name`, not `id`/`label`: this is the wire, and
 * `api.ts` is where it becomes the browser's own shape. Renaming inside the
 * schema would have meant validating a document that does not exist.
 */
export const workspaceSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    display_name: text.nullish(),
    state: text.nullish(),
    storage_kind: z.enum(['external', 'managed', 'local']).nullish(),
    created_at: z.number().finite().nullish(),
    last_accessed_at: z.number().finite().nullish(),
    naming_state: z.enum(['pending', 'generated', 'manual']).nullish(),
  })
  .passthrough();

/** A workspace, as the browser names one. */
export interface Workspace {
  readonly id: string;
  readonly label: string;
  readonly archived: boolean;
  readonly storageKind: 'external' | 'managed';
  readonly createdAt: number;
  readonly lastAccessedAt: number;
  readonly namingState: 'pending' | 'generated' | 'manual';
}

export const managedJobSchema = z
  .object({
    workspace_id: workspaceIdSchema,
    job_id: text,
    conversation_id: conversationIdSchema,
    conversation_title: z.string(),
    resource_id: text,
    analyzer_resource_id: text.nullable(),
    job_kind: z.enum(['timing_predict', 'kernel_profile', 'kernel_measure']),
    status: text,
    created_at: z.number().finite(),
    updated_at: z.number().finite(),
  })
  .passthrough();

export interface ManagedJob {
  readonly workspaceId: string;
  readonly jobId: string;
  readonly conversationId: string;
  readonly conversationTitle: string;
  readonly resourceId: string;
  readonly analyzerResourceId: string | null;
  readonly jobKind: 'timing_predict' | 'kernel_profile' | 'kernel_measure';
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** The event that ends a turn: the answer that will be stored, and how it ended. */
export const doneEventSchema = z
  .object({
    text: text,
    outcome: text.nullish(),
    citations: z.array(citationSchema).nullish(),
    failure: z.unknown().optional(),
    interrupted_role: text.nullish(),
  })
  .passthrough();

/**
 * What the browser knows about a conversation right now.
 *
 * `status` is what this browser can currently say about the conversation, and
 * that deliberately mixes two things it cannot separate: what the turn is doing
 * and what this browser is hearing. `streaming` and `detached` are the pair
 * that matters. `streaming` is this browser listening to a turn it can hear;
 * `detached` is no subscription at all, with whatever the conversation is doing
 * left unconfirmed — it is reached by letting go of a stream *or* of the read
 * that was going to say whether anything is running. One word for both would
 * leave a reader unable to tell a finished conversation from an unheard one.
 */
export type SessionStatus = 'idle' | 'loading' | 'streaming' | 'detached' | 'cancelling' | 'failed';

export interface SessionState {
  readonly ref: SessionRef;
  readonly title: string;
  readonly namingState: string;
  readonly codexRuntime: CodexRuntimeSelection | null;
  readonly agentSettings: AgentSettings | null;
  readonly status: SessionStatus;
  readonly messages: readonly StoredMessage[];
  /** Events of the turn in flight. Empty once it lands and becomes a message. */
  readonly live: readonly TurnEvent[];
  /** Absolute position of `messages[0]`; `0` once the whole history is loaded. */
  readonly startIndex: number;
  readonly hasEarlier: boolean;
  /**
   * The role the next message will continue, when a turn was interrupted and
   * its follow-up has not been sent. Empty otherwise. The backend keeps it, and
   * the reader needs it to know where their next message lands.
   */
  readonly interruptedRole: string;
  /**
   * The last thing that went wrong, held separately from `status` because most
   * failures do not stop the session: a page of history that would not load, a
   * cancel the backend refused. Cleared when a new turn starts and when the
   * conversation is reloaded — the two moments that replace what it described —
   * and otherwise kept, since a reader who is still reading has not stopped
   * needing to know.
   */
  readonly error: string | null;
}

export function idleState(ref: SessionRef): SessionState {
  return {
    ref,
    title: 'New conversation',
    namingState: 'manual',
    codexRuntime: null,
    agentSettings: null,
    status: 'idle',
    messages: [],
    live: [],
    startIndex: 0,
    hasEarlier: false,
    interruptedRole: '',
    error: null,
  };
}

/** Validate a ref before it becomes two path segments. */
export function parseSessionRef(workspace: string, conversation: string): SessionRef | null {
  const w = workspaceIdSchema.safeParse(workspace);
  const c = conversationIdSchema.safeParse(conversation);
  if (!w.success || !c.success) return null;
  return { workspace: w.data, conversation: c.data };
}
