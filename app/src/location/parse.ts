/**
 * The URL back into a `Location`.
 *
 * Total and side-effect free: it never throws and it never reads `window`. The
 * ambient workspace is passed in, because a hash without `w=` is still a valid
 * link — the deployment or the current session supplies the default, and
 * deciding that is `navigate.ts`'s job.
 *
 * Anything that cannot be represented returns `null`: an unknown route, a
 * malformed drill-down path, a percent escape that does not decode. Falling back
 * to the catalog would hide the fact that the link was wrong, and `app/resolve`
 * already has to report `not-found` for unknown panels.
 *
 * Forward compatibility has one deliberate asymmetry. Unknown *parameters* are
 * ignored, so an older build still opens a newer link. Unknown *option keys* are
 * kept, so a future panel's option round-trips, but an option key outside the
 * documented charset is rejected — that is what lets `format.ts` write option
 * keys verbatim and stay total.
 */
import {
  DECIMAL_PATTERN,
  DRAFT_CHAT,
  KIND_BY_SLUG,
  MILLISECONDS_PATTERN,
  OPTION_PREFIX,
  PARAM,
  ROUTE,
  OPTION_KEY_PATTERN,
  percentDecode,
  splitRawQuery,
} from './grammar';
import { decodePath } from './segments';
import {
  canonicalKinds,
  locationSchema,
  workspaceIdSchema,
  type ChatRef,
  type Focus,
  type Location,
  type PanelOptions,
  type ResultKind,
  type WorkspaceId,
} from './types';

export interface LocationDefaults {
  /** Used when the hash carries no `w=`. */
  workspace: WorkspaceId;
}

/**
 * Query values as they appear in the URL, still escaped. `at=` is read raw because
 * its `.` `~` `:` are grammar; everything else goes through `readOptionalText`.
 * Every value is known to decode — `parseLocation` rejects the whole hash
 * otherwise — so no reader below has to carry a "malformed" case.
 */
type Query = ReadonlyMap<string, string>;

export function parseLocation(hash: string, defaults: LocationDefaults): Location | null {
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  const separator = path.indexOf('?');
  const query = splitRawQuery(separator === -1 ? '' : path.slice(separator + 1));
  for (const value of query.values()) {
    if (percentDecode(value) === null) return null;
  }

  const route = routeSegments(separator === -1 ? path : path.slice(0, separator));
  if (route === null) return null;

  const workspace = readWorkspace(query, defaults);
  if (workspace === null) return null;

  const location = parseRoute(route, query, workspace);
  if (location === null) return null;

  // One gate for every bound the schemas declare, so a hand-edited hash cannot
  // produce a value the rest of the app is entitled to assume is well-formed.
  const checked = locationSchema.safeParse(location);
  return checked.success ? checked.data : null;
}

/** `/result/run/20260715_1` → `['result', 'run', '20260715_1']`. */
function routeSegments(route: string): string[] | null {
  const trimmed = route.endsWith('/') ? route.slice(0, -1) : route;
  if (trimmed === '') return [];
  if (!trimmed.startsWith('/')) return null;
  const segments: string[] = [];
  for (const encoded of trimmed.slice(1).split('/')) {
    const segment = percentDecode(encoded);
    if (segment === null || segment === '') return null;
    segments.push(segment);
  }
  return segments;
}

function readWorkspace(query: Query, defaults: LocationDefaults): WorkspaceId | null {
  const raw = readOptionalText(query, PARAM.workspace);
  if (raw === undefined) return defaults.workspace;
  const checked = workspaceIdSchema.safeParse(raw);
  return checked.success ? checked.data : null;
}

function parseRoute(route: string[], query: Query, workspace: WorkspaceId): Location | null {
  // An empty route is the entry address, `#/`.
  if (route.length === 0) return parseCatalog(query, workspace);
  const [head, ...rest] = route;
  switch (head) {
    case ROUTE.catalog:
      return rest.length === 0 ? parseCatalog(query, workspace) : null;
    case ROUTE.result:
      return parseResult(rest, query, workspace);
    case ROUTE.chat:
      return parseChat(rest, workspace);
    case ROUTE.file:
      return rest.length === 0 ? parseFile(query, workspace) : null;
    default:
      return null;
  }
}

function parseCatalog(query: Query, workspace: WorkspaceId): Location | null {
  const kinds = readKinds(query);
  if (kinds === null) return null;
  const workspaces = readCatalogValues(query, PARAM.catalogWorkspaces);
  const deployments = readCatalogValues(query, PARAM.deployments);
  const traces = readCatalogValues(query, PARAM.traces);
  const axes = readCatalogValues(query, PARAM.axes);
  if (workspaces === null || deployments === null || traces === null || axes === null) return null;
  return {
    view: 'catalog',
    filter: {
      workspace,
      kinds,
      query: readOptionalText(query, PARAM.query) ?? null,
      ...(workspaces === undefined ? {} : { workspaces }),
      ...(deployments === undefined ? {} : { deployments }),
      ...(traces === undefined ? {} : { traces }),
      ...(axes === undefined ? {} : { axes }),
    },
  };
}

function parseResult(route: string[], query: Query, workspace: WorkspaceId): Location | null {
  if (route.length !== 2) return null;
  const [slug, id] = route;
  const kind = KIND_BY_SLUG.get(slug);
  if (kind === undefined) return null;

  const focus = readFocus(query);
  if (focus === null) return null;

  const chatValue = readOptionalText(query, PARAM.chat);
  const chat = chatValue === undefined ? null : readChat(chatValue, workspace);

  const revision = readOptionalText(query, PARAM.revision);
  return {
    view: 'result',
    ref: { kind, id, workspace, ...(revision === undefined ? {} : { revision }) },
    focus,
    chat,
  };
}

function parseChat(route: string[], workspace: WorkspaceId): Location | null {
  if (route.length !== 1) return null;
  return { view: 'chat', chat: readChat(route[0], workspace) };
}

function parseFile(query: Query, workspace: WorkspaceId): Location | null {
  const path = readOptionalText(query, PARAM.path);
  if (path === undefined) return null;
  const line = readOptionalText(query, PARAM.line);
  if (line === undefined) return { view: 'file', file: { workspace, path, line: null } };
  if (!DECIMAL_PATTERN.test(line)) return null;
  return { view: 'file', file: { workspace, path, line: Number(line) } };
}

/** A parameter's decoded text, or `undefined` when it is absent or empty. */
function readOptionalText(query: Query, key: string): string | undefined {
  const raw = query.get(key);
  if (raw === undefined) return undefined;
  const decoded = percentDecode(raw);
  return decoded === null || decoded === '' ? undefined : decoded;
}

/** An absent or empty `kind=` means every kind. The result is in canonical
 * order, not the order the caller happened to type. */
function readKinds(query: Query): ResultKind[] | null {
  const raw = readOptionalText(query, PARAM.kinds);
  if (raw === undefined) return [];
  const kinds: ResultKind[] = [];
  for (const slug of raw.split(',')) {
    const kind = KIND_BY_SLUG.get(slug);
    if (kind === undefined) return null;
    kinds.push(kind);
  }
  return canonicalKinds(kinds);
}

/** A comma-separated catalog facet. Values are split in wire form so a comma
 * inside one opaque value remains `%2C` and does not become a separator. */
function readCatalogValues(query: Query, key: string): string[] | undefined | null {
  const raw = query.get(key);
  if (raw === undefined) return undefined;
  if (raw === '') return null;
  const values: string[] = [];
  for (const part of raw.split(',')) {
    const value = percentDecode(part);
    if (value === null || value === '') return null;
    values.push(value);
  }
  return [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function readFocus(query: Query): Focus | null {
  const rawPath = query.get(PARAM.at);
  const path = rawPath === undefined ? [] : decodePath(rawPath);
  if (path === null) return null;

  const rawCursor = query.get(PARAM.cursor);
  if (rawCursor !== undefined && !MILLISECONDS_PATTERN.test(rawCursor)) return null;
  const cursorMs = rawCursor === undefined ? null : Number(rawCursor);

  const options = readOptions(query);
  if (options === null) return null;

  return { path, cursorMs, panel: readOptionalText(query, PARAM.panel) ?? null, options };
}

function readOptions(query: Query): PanelOptions | null {
  const options: Record<string, string> = {};
  for (const [key, raw] of query) {
    if (!key.startsWith(OPTION_PREFIX)) continue;
    const name = key.slice(OPTION_PREFIX.length);
    if (!OPTION_KEY_PATTERN.test(name)) return null;
    const value = percentDecode(raw);
    if (value === null || value === '') return null;
    options[name] = value;
  }
  return options;
}

/**
 * Takes text that has already been decoded — `routeSegments` decodes the path and
 * `readOptionalText` decodes the query, so decoding again here would corrupt any id
 * containing a percent sign. The id's own bounds are checked by the
 * `locationSchema` gate, so this cannot fail.
 */
function readChat(value: string, workspace: WorkspaceId): ChatRef {
  if (value === DRAFT_CHAT) return { state: 'draft', workspace };
  return { state: 'created', workspace, id: value };
}
