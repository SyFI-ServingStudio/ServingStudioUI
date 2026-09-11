/**
 * A `Location` into its URL. The inverse of `parse.ts`, and the only place that
 * decides what a canonical address looks like.
 *
 * Canonical means: `w=` always present, so a copied link is self-contained;
 * defaults omitted (no `at=` for an empty path, no `t=` for no cursor); option
 * keys sorted. Formatting is therefore idempotent — `format(parse(format(l)))`
 * equals `format(l)` — which is what lets a normalizing `replace` settle instead
 * of oscillating.
 *
 * Like `grammar.ts`, everything here works in wire form: each value is escaped
 * exactly once, at the point where it becomes a URL fragment — see
 * `encodeFilePath` below for the one parameter with its own escaping rule.
 */
import {
  DRAFT_CHAT,
  KIND_SLUG,
  OPTION_PREFIX,
  PARAM,
  ROUTE,
  joinEncodedQuery,
  percentEncode,
} from './grammar';
import { encodePath } from './segments';
import {
  canonicalKinds,
  workspaceOf,
  type CatalogFilter,
  type ChatRef,
  type FileRef,
  type Focus,
  type Location,
  type ResultRef,
} from './types';

type Param = readonly [key: string, wireValue: string];

export function formatLocation(location: Location): string {
  const workspace: Param = [PARAM.workspace, percentEncode(workspaceOf(location))];
  switch (location.view) {
    case 'catalog':
      return url([ROUTE.catalog], [workspace, ...catalogParams(location.filter)]);
    case 'result':
      return url(
        [ROUTE.result, KIND_SLUG[location.ref.kind], percentEncode(location.ref.id)],
        [workspace, ...resultParams(location.ref, location.focus, location.chat)],
      );
    case 'chat':
      return url([ROUTE.chat, chatSlug(location.chat)], [workspace]);
    case 'file':
      return url([ROUTE.file], [workspace, ...fileParams(location.file)]);
  }
}

/**
 * Whether two Locations address the same thing.
 *
 * Compares canonical URLs rather than deep-equalling nested objects: the URL is
 * the definition of identity here, so two values that differ only in option
 * insertion order or a redundant field are correctly the same.
 */
export function sameLocation(left: Location, right: Location): boolean {
  return formatLocation(left) === formatLocation(right);
}

/** Both arguments are already in wire form. */
function url(segments: readonly string[], params: readonly Param[]): string {
  return `#/${segments.join('/')}?${joinEncodedQuery(params)}`;
}

function catalogParams(filter: CatalogFilter): Param[] {
  const params: Param[] = [];
  // Canonical order and de-duplicated, so a filter assembled in click order
  // still has one address.
  const kinds = canonicalKinds(filter.kinds);
  if (kinds.length > 0) {
    params.push([PARAM.kinds, kinds.map((kind) => KIND_SLUG[kind]).join(',')]);
  }
  if (filter.query !== null) params.push([PARAM.query, percentEncode(filter.query)]);
  appendCatalogValues(params, PARAM.catalogWorkspaces, filter.workspaces);
  appendCatalogValues(params, PARAM.deployments, filter.deployments);
  appendCatalogValues(params, PARAM.traces, filter.traces);
  appendCatalogValues(params, PARAM.axes, filter.axes);
  return params;
}

function appendCatalogValues(
  params: Param[],
  key: string,
  values: readonly string[] | undefined,
): void {
  if (values === undefined || values.length === 0) return;
  const canonical = [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  params.push([key, canonical.map(percentEncode).join(',')]);
}

function resultParams(ref: ResultRef, focus: Focus, chat: ChatRef | null): Param[] {
  const params: Param[] = [];
  if (ref.revision !== undefined) params.push([PARAM.revision, percentEncode(ref.revision)]);
  if (focus.path.length > 0) params.push([PARAM.at, encodePath(focus.path)]);
  if (focus.cursorMs !== null) params.push([PARAM.cursor, String(focus.cursorMs)]);
  if (focus.panel !== null) params.push([PARAM.panel, percentEncode(focus.panel)]);
  // Sorted so two Locations differing only in insertion order share one URL, and
  // therefore one query cache key.
  for (const key of Object.keys(focus.options).sort()) {
    params.push([`${OPTION_PREFIX}${key}`, percentEncode(focus.options[key])]);
  }
  if (chat !== null) params.push([PARAM.chat, chatSlug(chat)]);
  return params;
}

/**
 * `/` is legal in a query value, and file links are the ones users read and
 * paste, so separators are left intact. Nothing else changes: a literal `%` in a
 * path is still escaped first, so `%2F` cannot appear by accident.
 */
function encodeFilePath(path: string): string {
  return percentEncode(path).replace(/%2F/g, '/');
}

function fileParams(file: FileRef): Param[] {
  const params: Param[] = [[PARAM.path, encodeFilePath(file.path)]];
  if (file.line !== null) params.push([PARAM.line, String(file.line)]);
  return params;
}

function chatSlug(chat: ChatRef): string {
  return chat.state === 'draft' ? DRAFT_CHAT : percentEncode(chat.id);
}
