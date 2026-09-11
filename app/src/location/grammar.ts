/**
 * The URL grammar shared by `parse.ts` and `format.ts`: route names, parameter
 * names, and the percent codec.
 *
 * Query values are handled in *wire form* on both sides: `joinEncodedQuery` takes
 * values that are already escaped, and `splitRawQuery` returns them still
 * escaped. The names say so because the types cannot — both are plain `string`.
 *
 * The reason for the convention is `at=`, whose `.` `~` `:` are path grammar and
 * must survive, next to `path=`, which is opaque text that must be escaped. One
 * blanket rule cannot serve both, so each parameter's reader and writer decide,
 * and the decision is visible at the call site instead of buried in a helper.
 *
 * `URLSearchParams` is not used for either direction. It escapes `~`, which would
 * make every drill-down path unreadable, and it decodes `+` as a space, which
 * would corrupt tokens that legitimately contain one.
 *
 * This file owns the grammar primitives shared by `parse` and `format`. It is not
 * the sole home of URL knowledge: path segment delimiters live in `segments.ts`,
 * route splitting in `parse.ts`, and the file-path escape in `format.ts`.
 */
import type { ResultKind } from './types';

/** First path segment of each view's hash route. */
export const ROUTE = {
  catalog: 'results',
  result: 'result',
  chat: 'chat',
  file: 'file',
} as const;

/** URL spelling of a result kind. Kebab-case on the wire, camelCase in types. */
export const KIND_SLUG: Record<ResultKind, string> = {
  sweep: 'sweep',
  run: 'run',
  prediction: 'prediction',
  alignment: 'alignment',
  kernelProfile: 'kernel-profile',
  kernelMeasurement: 'kernel-measurement',
};

export const KIND_BY_SLUG: ReadonlyMap<string, ResultKind> = new Map(
  Object.entries(KIND_SLUG).map(([kind, slug]) => [slug, kind as ResultKind]),
);

export const PARAM = {
  workspace: 'w',
  revision: 'rev',
  at: 'at',
  cursor: 't',
  panel: 'panel',
  chat: 'chat',
  kinds: 'kind',
  query: 'q',
  catalogWorkspaces: 'workspace',
  deployments: 'deployment',
  traces: 'trace',
  axes: 'axis',
  path: 'path',
  line: 'line',
} as const;

/** Panel options are namespaced so an unprefixed parameter can never collide
 * with one, and so `format` can round-trip options it does not understand. */
export const OPTION_PREFIX = 'o.';

/**
 * Option keys are restricted to this charset so `format` can write them verbatim.
 * Shared with `types.ts`, which enforces the same rule on constructed values.
 */
export const OPTION_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * The conversation id that means "not created yet". Safe to reserve: backend ids
 * are uuid4 hex (`backend/store.py`), so none can be this word.
 */
export const DRAFT_CHAT = 'new';

/**
 * Canonical wire form of the numbers this grammar carries. A value `String()`
 * would render as `1e-7`, or a hash carrying `01`, has no canonical URL — so the
 * schemas in `types.ts` exclude it rather than letting `format` emit something
 * `parse` would reject.
 */
export const DECIMAL_PATTERN = /^(0|[1-9]\d*)$/;
export const MILLISECONDS_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

export function percentEncode(value: string): string {
  return encodeURIComponent(value);
}

/** Null for a malformed escape (`%zz`) — a broken link, not a value. */
export function percentDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Values must already be escaped; see the note at the top of this file. */
export function joinEncodedQuery(params: readonly (readonly [string, string])[]): string {
  return params.map(([key, value]) => `${key}=${value}`).join('&');
}

/**
 * Query string into still-escaped values, keyed by decoded name. Malformed pairs
 * are skipped rather than failing the whole parse, and the first occurrence of a
 * repeated key wins — canonical URLs never repeat one.
 */
export function splitRawQuery(raw: string): ReadonlyMap<string, string> {
  const params = new Map<string, string>();
  if (raw === '') return params;
  for (const pair of raw.split('&')) {
    if (pair === '') continue;
    const separator = pair.indexOf('=');
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const key = percentDecode(rawKey);
    if (key === null || key === '' || params.has(key)) continue;
    params.set(key, separator === -1 ? '' : pair.slice(separator + 1));
  }
  return params;
}
