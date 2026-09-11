/**
 * The drill-down path: its wire grammar and its structural rules.
 *
 * Grammar — segments joined by `.`, a segment's kind separated from its values
 * by `:`, and the values of one segment joined by `~`:
 *
 *     pool:decode.worker:3.operation:12~4~7.leaf:31
 *
 * All three delimiters are unreserved in a URL, so the common case (tokens made
 * of letters, digits, `_` and `-`) survives a round trip unescaped and stays
 * readable in the address bar. `encodeToken` escapes the delimiters when a token
 * does contain one, which keeps the codec total for opaque server ids rather
 * than restricting what the Analyzer may mint.
 *
 * Structure — a segment may only follow the segments it can meaningfully refine
 * (`ALLOWED_PARENTS`). That table is the whole legality check. It rules out a
 * kind appearing twice on one path because the relation it describes is
 * **acyclic**, not merely because no kind is its own parent: without acyclicity a
 * path could still repeat a kind as `A → B → A`. `segmentOf`'s "the one segment
 * of this kind" and `upTo`'s behaviour both rest on that stronger property, so
 * `segments.test.ts` asserts it directly rather than trusting this paragraph.
 *
 * What the table deliberately does not know is which kinds belong to which
 * resource — `case:` under a run is well-formed here and simply has no panel that
 * consumes it, which `layouts/` and `panels/` decide.
 */
import { DECIMAL_PATTERN, percentDecode, percentEncode } from './grammar';
import type { Segment, SegmentKind, SweepCoordinates } from './types';

const SEGMENT_SEPARATOR = '.';
const KIND_SEPARATOR = ':';
const VALUE_SEPARATOR = '~';

/** The delimiters above. `encodeURIComponent` already escapes `:`; `.` and `~`
 * it leaves alone, so they are escaped explicitly here. */
const DELIMITERS = /[.:~]/g;

function escapeDelimiter(character: string): string {
  return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

export function encodeToken(value: string): string {
  return percentEncode(value).replace(DELIMITERS, escapeDelimiter);
}

/** `DECIMAL_PATTERN` rejects `01`, `1e3`, `+1`, `Infinity` and the empty string,
 * all of which `Number()` would happily accept or coerce. */
function decodeIndex(raw: string): number | null {
  if (!DECIMAL_PATTERN.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Which segment kinds a given kind may follow. `'root'` means it may start the
 * path. Must stay acyclic; see the note at the top of this file.
 */
export const ALLOWED_PARENTS: Record<SegmentKind, readonly (SegmentKind | 'root')[]> = {
  pool: ['root'],
  worker: ['pool'],
  operation: ['worker'],
  // A cost-tree node is read either from a resolved operation or from a worker
  // held at a wall-clock cursor, and predictions reach it through a case.
  leaf: ['worker', 'operation', 'caseOperation'],
  parallel: ['worker', 'operation', 'caseOperation'],
  case: ['root'],
  caseOperation: ['case'],
  iteration: ['root'],
  run: ['root'],
};

/** Whether `kind` may refine `parent`, where `'root'` is the start of a path. */
export function canFollow(parent: SegmentKind | 'root', kind: SegmentKind): boolean {
  return ALLOWED_PARENTS[kind].includes(parent);
}

export function isValidPath(path: readonly Segment[]): boolean {
  return path.every((segment, index) =>
    canFollow(index === 0 ? 'root' : path[index - 1].at, segment.at),
  );
}

/**
 * The one segment of a given kind on a path, or null.
 *
 * Panels read their coordinates through this instead of indexing by position,
 * which is what lets a path grow a level without touching every consumer.
 */
export function segmentOf<K extends SegmentKind>(
  path: readonly Segment[],
  at: K,
): Extract<Segment, { at: K }> | null {
  const found = path.find((segment) => segment.at === at);
  return found === undefined ? null : (found as Extract<Segment, { at: K }>);
}

function encodeValues(segment: Segment): readonly string[] {
  switch (segment.at) {
    case 'pool':
      return [segment.role];
    case 'worker':
      return [segment.id];
    case 'operation':
      return [segment.iter, segment.batch, segment.op];
    case 'leaf':
    case 'parallel':
    case 'iteration':
      return [String(segment.id)];
    case 'case':
    case 'caseOperation':
      return [segment.id];
    case 'run':
      if (segment.coordinates === undefined) return [segment.id!];
      return [segment.id ?? '', canonicalCoordinates(segment.coordinates)];
  }
}

/**
 * Value lists back into segments. Keyed by kind so a new segment variant fails
 * to compile until it is decodable, and returning null for the wrong arity so a
 * truncated link is rejected rather than half-read.
 */
const DECODERS: Record<SegmentKind, (values: readonly string[]) => Segment | null> = {
  pool: (values) => (values.length === 1 ? { at: 'pool', role: values[0] } : null),
  worker: (values) => (values.length === 1 ? { at: 'worker', id: values[0] } : null),
  operation: (values) =>
    values.length === 3
      ? { at: 'operation', iter: values[0], batch: values[1], op: values[2] }
      : null,
  leaf: (values) => decodeIndexSegment('leaf', values),
  parallel: (values) => decodeIndexSegment('parallel', values),
  iteration: (values) => decodeIndexSegment('iteration', values),
  case: (values) => (values.length === 1 ? { at: 'case', id: values[0] } : null),
  caseOperation: (values) => (values.length === 1 ? { at: 'caseOperation', id: values[0] } : null),
  run: (values) => {
    if (values.length === 1) return values[0] === '' ? null : { at: 'run', id: values[0] };
    if (values.length !== 2) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(values[1]);
    } catch {
      return null;
    }
    const coordinates = decodeCoordinates(parsed);
    if (coordinates === null) return null;
    return values[0] === ''
      ? { at: 'run', coordinates }
      : { at: 'run', id: values[0], coordinates };
  },
};

function canonicalCoordinates(coordinates: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(coordinates)
        .sort()
        .map((axis) => [axis, coordinates[axis]]),
    ),
  );
}

function decodeCoordinates(value: unknown): SweepCoordinates | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const coordinates = value as Record<string, unknown>;
  const validPrimitive = (item: unknown) =>
    item === null ||
    typeof item === 'string' ||
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item));
  return Object.values(coordinates).every(
    (coordinate) =>
      validPrimitive(coordinate) || (Array.isArray(coordinate) && coordinate.every(validPrimitive)),
  )
    ? (coordinates as SweepCoordinates)
    : null;
}

function decodeIndexSegment(
  at: 'leaf' | 'parallel' | 'iteration',
  values: readonly string[],
): Segment | null {
  if (values.length !== 1) return null;
  const id = decodeIndex(values[0]);
  return id === null ? null : { at, id };
}

const SEGMENT_KINDS: ReadonlySet<string> = new Set(Object.keys(DECODERS));

function isSegmentKind(value: string): value is SegmentKind {
  return SEGMENT_KINDS.has(value);
}

export function encodeSegment(segment: Segment): string {
  const values = encodeValues(segment).map(encodeToken).join(VALUE_SEPARATOR);
  return `${segment.at}${KIND_SEPARATOR}${values}`;
}

export function decodeSegment(raw: string): Segment | null {
  const separator = raw.indexOf(KIND_SEPARATOR);
  if (separator <= 0) return null;
  const kind = raw.slice(0, separator);
  if (!isSegmentKind(kind)) return null;

  const values: string[] = [];
  for (const encoded of raw.slice(separator + 1).split(VALUE_SEPARATOR)) {
    const value = percentDecode(encoded);
    if (value === null) return null;
    values.push(value);
  }

  // Bounds (token length, safe integers) are not re-checked here: `focusSchema`
  // is the single gate every decoded path passes through, and duplicating it
  // would mean two places to keep in step.
  return DECODERS[kind](values);
}

export function encodePath(path: readonly Segment[]): string {
  return path.map(encodeSegment).join(SEGMENT_SEPARATOR);
}

/**
 * Parse a path and accept it only if it is also structurally legal — a
 * grammatically well-formed but impossible path (`worker:3` with no pool) is not
 * a path. Callers therefore cannot forget the second check.
 */
export function decodePath(raw: string): Segment[] | null {
  if (raw === '') return [];
  const path: Segment[] = [];
  for (const encoded of raw.split(SEGMENT_SEPARATOR)) {
    const segment = decodeSegment(encoded);
    if (segment === null) return null;
    path.push(segment);
  }
  return isValidPath(path) ? path : null;
}
