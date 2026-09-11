/**
 * `Location` — the only state this application shares.
 *
 * A Location answers one question: *which result, and what am I looking at
 * inside it*. That single value is simultaneously the view state, the shareable
 * address, and the evidence pointer the Agent cites. There is no selection
 * store: a value that is not in the Location is component-local and therefore
 * unshareable, on purpose.
 *
 * Three rules hold this module together.
 *
 * 1. Only committed, shareable values live here. No hover, no mid-drag cursor,
 *    no panel geometry, and above all no loading flags — the old
 *    `cursorNeedsSeek` has nowhere to go in this type, which is the point.
 * 2. Drill-down is one ordered `Segment[]` path, and each segment contributes
 *    exactly the coordinate it names. A worker segment carries a worker id and
 *    nothing else; its pool comes from the segment before it. Legality is then a
 *    prefix check (`segments.ts`) instead of a matrix of mutually-consistent
 *    fields.
 * 3. `panel` and `options` are opaque here. This module must not know which
 *    panels exist; `app/resolve.ts` validates them against the registry.
 *
 * The schemas are the source of truth and the types are inferred from them,
 * because these values also arrive from outside the browser — the conversation
 * backend freezes them into turn events — and must be validated rather than
 * cast.
 */
import { z } from 'zod';
import { DRAFT_CHAT, MILLISECONDS_PATTERN, OPTION_KEY_PATTERN } from './grammar';
import { isValidPath } from './segments';

/**
 * `encodeURIComponent` throws a `URIError` on a lone surrogate, so a string that
 * cannot be escaped is not a valid token — admitting one would make
 * `formatLocation` throw on a value the type system had blessed. Re-encoding is
 * the only way to ask, and these schemas run only on parse and on the
 * development-mode check in `navigate`.
 */
function isEscapable(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

/** A bounded, escapable, non-empty string: the shape of every opaque token here. */
function token(max: number) {
  return z.string().min(1).max(max).refine(isEscapable, {
    message: 'value contains an unpaired surrogate and cannot be put in a URL',
  });
}

/**
 * A token that also becomes an HTTP path segment.
 *
 * `.` and `..` are refused because no amount of escaping saves them.
 * `encodeURIComponent` leaves a dot alone — it is unreserved — and even a
 * hand-written `%2E%2E` is decoded by the URL parser and *then* resolved away,
 * so a pool tag of `..` turns `/runs/r/workers/../0/subjects/kernel-time-share`
 * into `/runs/r/0/subjects/kernel-time-share`: a different route, answered by a
 * different document or by a 404, with nothing anywhere saying so.
 *
 * Refusing the token is therefore the only defence, and it belongs here rather
 * than at each read: every one of these strings reaches a URL eventually, and a
 * rule spelled once at the boundary they share cannot be forgotten by the next
 * artifact.
 */
function pathToken(max: number) {
  return token(max).refine((value) => value !== '.' && value !== '..', {
    message: 'a token of "." or ".." addresses a different route once a URL is built',
  });
}

/**
 * Mirrors the Agent backend's workspace id pattern (`backend/store.py`), which
 * is wider than its current generator (`w_<12 hex>`), so a hash typed by hand
 * for an older workspace still resolves.
 */
export const workspaceIdSchema = z.string().regex(/^w_[A-Za-z0-9_-]{1,64}$/);
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;

/**
 * Conversation ids are opaque backend tokens with no prefix. Mirrors
 * `backend/store.py::_validate_conversation_id` so a malformed hash cannot reach
 * a fetch or be used to build a path, and additionally excludes the slug the
 * grammar reserves for a draft — an id of `new` would format as `#/chat/new` and
 * read back as a draft. The backend mints uuid4 hex, so nothing real is lost;
 * the point is that the invariant is enforced rather than assumed.
 */
export const conversationIdSchema = pathToken(80).refine(
  (value) => !value.includes('/') && !value.includes('\\') && value !== DRAFT_CHAT,
  { message: 'conversation id must not be usable as a path or shadow the draft slug' },
);
export type ConversationId = z.infer<typeof conversationIdSchema>;

export const resultKindSchema = z.enum([
  'sweep',
  'run',
  'prediction',
  'alignment',
  'kernelProfile',
  'kernelMeasurement',
]);
export type ResultKind = z.infer<typeof resultKindSchema>;

/**
 * Result kinds in canonical order, de-duplicated.
 *
 * Both the parser and the formatter go through this. Without it, a filter built in
 * some other order would serialize in that order and parse back canonical, so
 * `format(parse(format(l)))` would not equal `format(l)` — a normalizing `replace`
 * would then write a second, different address before settling.
 */
export function canonicalKinds(kinds: readonly ResultKind[]): ResultKind[] {
  return resultKindSchema.options.filter((kind) => kinds.includes(kind));
}

/**
 * Result ids are opaque server-issued tokens — real run ids look like
 * `20260715_1_test`; they are identities rather than paths. They are
 * length-bounded and percent-encoded when
 * serialized, never pattern-matched, so the UI does not have to be revised when
 * the Analyzer changes how it mints them.
 */
export const resultIdSchema = pathToken(128);
export type ResultId = z.infer<typeof resultIdSchema>;

/**
 * Which result is open. Self-contained: a ref is enough to build every URL for
 * that result, so it can travel into `needs()`, cache keys, and frozen
 * citations without an ambient workspace.
 */
export const resultRefSchema = z
  .object({
    kind: resultKindSchema,
    id: resultIdSchema,
    workspace: workspaceIdSchema,
    /**
     * Analysis revision. Absent means "whatever the newest analysis is", and
     * stays absent: nothing yet resolves it to a number and rewrites the URL,
     * so such a read follows re-analysis rather than being cacheable forever.
     * It is a distinct cache key from every pinned revision — see
     * `artifacts/ref.ts` — which is what keeps the two from being confused
     * while that resolution does not exist.
     */
    revision: token(64).optional(),
  })
  .strict()
  .superRefine((ref, context) => {
    if (
      ref.revision !== undefined &&
      (ref.kind === 'kernelProfile' || ref.kind === 'kernelMeasurement')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revision'],
        message: `${ref.kind} routes do not support revision-pinned reads`,
      });
    }
  });
export type ResultRef = z.infer<typeof resultRefSchema>;

/** Route tokens (pool roles, worker ids, operation coordinates) are opaque. */
const routeToken = pathToken(128);
/** Node ids come from Analyzer payloads as non-negative integer indices. */
const nodeIndex = z.number().int().nonnegative().safe();
const coordinatePrimitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const coordinateValue = z.union([coordinatePrimitive, z.array(coordinatePrimitive).readonly()]);
export const sweepCoordinatesSchema = z.record(coordinateValue);
export type SweepCoordinates = z.infer<typeof sweepCoordinatesSchema>;

/**
 * One step of a drill-down.
 *
 * Each variant adds only its own coordinate; ancestors supply the rest. Two
 * operation-like variants exist because a measured run's operation needs
 * (iteration, batch, operation) to be unique while a prediction case has a flat
 * list of operations — collapsing them would mean padding one with empty
 * strings.
 */
export const segmentSchema = z.discriminatedUnion('at', [
  z.object({ at: z.literal('pool'), role: routeToken }).strict(),
  /** Worker ids are unique only inside a pool, so this must follow a `pool`. */
  z.object({ at: z.literal('worker'), id: routeToken }).strict(),
  z
    .object({
      at: z.literal('operation'),
      iter: routeToken,
      batch: routeToken,
      op: routeToken,
    })
    .strict(),
  /** A leaf of the cost tree — the old `leafId`. */
  z.object({ at: z.literal('leaf'), id: nodeIndex }).strict(),
  /** A max ("parallel") node of the cost tree — the old `parId`/`parallelId`. */
  z.object({ at: z.literal('parallel'), id: nodeIndex }).strict(),
  z.object({ at: z.literal('case'), id: routeToken }).strict(),
  z.object({ at: z.literal('caseOperation'), id: routeToken }).strict(),
  /** A paired iteration of an alignment bundle. */
  z.object({ at: z.literal('iteration'), id: nodeIndex }).strict(),
  /** One member inside a sweep. A producer may omit `run_id`, so coordinates
   * are the durable identity; `id` is retained when it exists so double-click
   * can open the measured run without another lookup. The one-value URL form
   * remains valid for links written before coordinate identity was added. */
  z
    .object({
      at: z.literal('run'),
      id: resultIdSchema.optional(),
      coordinates: sweepCoordinatesSchema.optional(),
    })
    .strict(),
]);
export type Segment = z.infer<typeof segmentSchema>;
export type SegmentKind = Segment['at'];

/**
 * Panel-scoped display choices that are worth sharing: which metric a sweep
 * chart plots, which statistic, whether an optimality ladder is batch-locked.
 *
 * Opaque to this module by design — a typed union here would make `location`
 * depend on panel semantics. Panels validate their own keys, and the registry
 * declares which keys each panel claims so nothing accumulates unowned.
 */
export const panelOptionsSchema = z.record(z.string().regex(OPTION_KEY_PATTERN), token(128));
export type PanelOptions = z.infer<typeof panelOptionsSchema>;

/**
 * Where inside a result the user is looking.
 *
 * `cursorMs` is a committed wall-clock cursor, not a drag position: the
 * component owns the drag and commits on pointer-up.
 */
export const focusSchema = z
  .object({
    // Legality is enforced wherever a path enters the application — the
    // `locationSchema` gate in `parse`, and the development check in `navigate`.
    // It is *not* a compile-time guarantee: `z.infer` yields a plain `Segment[]`,
    // so a value assembled in code can still be illegal until it is committed.
    // That is why the commit point, not each helper, is where it is checked.
    path: z
      .array(segmentSchema)
      .max(8)
      .refine(isValidPath, { message: 'each segment must refine the one before it' })
      .refine(
        (path) =>
          path.every(
            (segment) =>
              segment.at !== 'run' || segment.id !== undefined || segment.coordinates !== undefined,
          ),
        { message: 'a sweep member needs a run id or coordinates' },
      ),
    cursorMs: z
      .number()
      .finite()
      .nonnegative()
      .refine((value) => MILLISECONDS_PATTERN.test(String(value)), {
        message: 'cursor must be a plain decimal so that it survives the URL',
      })
      .nullable(),
    /** A registry panel id, opaque here; `app/resolve.ts` checks it exists. */
    panel: token(64).nullable(),
    options: panelOptionsSchema,
  })
  .strict();
export type Focus = z.infer<typeof focusSchema>;

export const EMPTY_FOCUS: Focus = { path: [], cursorMs: null, panel: null, options: {} };

/**
 * A conversation, which may not exist yet. `draft` is a real, shareable state —
 * "open the composer in this workspace" — and becomes `created` with a
 * `replace` the moment the backend issues an id.
 */
export const chatRefSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('draft'), workspace: workspaceIdSchema }).strict(),
  z
    .object({
      state: z.literal('created'),
      workspace: workspaceIdSchema,
      id: conversationIdSchema,
    })
    .strict(),
]);
export type ChatRef = z.infer<typeof chatRefSchema>;

/** `..` is rejected here rather than at the fetch, so a bad link fails to parse
 * instead of reaching the file API. */
const workspacePath = token(1024).refine((value) => !value.split('/').includes('..'), {
  message: 'path must not traverse',
});

export const fileRefSchema = z
  .object({
    workspace: workspaceIdSchema,
    path: workspacePath,
    line: z.number().int().positive().safe().nullable(),
  })
  .strict();
export type FileRef = z.infer<typeof fileRefSchema>;

/** An empty `kinds` list means every kind, which is also the default view. */
export const catalogFilterSchema = z
  .object({
    workspace: workspaceIdSchema,
    kinds: z.array(resultKindSchema).max(resultKindSchema.options.length),
    query: token(128).nullable(),
    // Facet values are catalog data. Keep them opaque like deployment/trace
    // facets; the active `workspace` field alone is an addressable workspace id.
    workspaces: z.array(token(128)).max(128).optional(),
    deployments: z.array(token(128)).max(128).optional(),
    traces: z.array(token(128)).max(128).optional(),
    axes: z.array(token(128)).max(128).optional(),
  })
  .strict();
export type CatalogFilter = z.infer<typeof catalogFilterSchema>;

export const locationSchema = z.discriminatedUnion('view', [
  z.object({ view: z.literal('catalog'), filter: catalogFilterSchema }).strict(),
  z
    .object({
      view: z.literal('result'),
      ref: resultRefSchema,
      focus: focusSchema,
      /** A conversation docked beside the result. Null is "no chat open", which
       * is not the same as a draft. */
      chat: chatRefSchema.nullable(),
    })
    .strict(),
  z.object({ view: z.literal('chat'), chat: chatRefSchema }).strict(),
  z.object({ view: z.literal('file'), file: fileRefSchema }).strict(),
]);
export type Location = z.infer<typeof locationSchema>;

/**
 * The workspace a Location belongs to.
 *
 * Every ref carries its own workspace so it can travel alone, but a Location
 * has exactly one: `w=` appears once in the URL and parsing stamps it into each
 * ref. For a result with a docked chat the result's workspace is authoritative,
 * so a hand-built value with a divergent chat workspace normalizes to the
 * result's on the next round trip rather than producing an unaddressable state.
 */
export function workspaceOf(location: Location): WorkspaceId {
  switch (location.view) {
    case 'catalog':
      return location.filter.workspace;
    case 'result':
      return location.ref.workspace;
    case 'chat':
      return location.chat.workspace;
    case 'file':
      return location.file.workspace;
  }
}
