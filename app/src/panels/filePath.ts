/**
 * Workspace file identity: what an Agent-authored reference points at, and how
 * the browser addresses it.
 *
 * The Agent writes file references two ways — an explicit Markdown link, and a
 * bare path in prose or backticks. `classifyLinkTarget` trusts the first
 * (the author said it was a link) and `detectPathToken` is deliberately
 * suspicious of the second, because prose is full of tokens that merely look
 * like paths (`s/old/new`, `p50/p99`, `TP/EP`).
 *
 * Transport-agnostic on purpose: this module owns the hash address and the
 * "is this a path" judgement. `/api/agent/v1/file*` URLs belong to
 * session/workspaceFiles, and the rendered file type comes from
 * the backend's meta response, not from a second guess here.
 */

export const FILE_ROUTE = '#/file';

export type LinkTarget =
  | { kind: 'external'; href: string }
  | { kind: 'app'; hash: string }
  | { kind: 'workspace-file'; path: string; line: number | null }
  | { kind: 'plain' };

export interface WorkspaceFileRef {
  workspaceId: string;
  path: string;
  line: number | null;
}

/** Mirrors the backend's WORKSPACE_ID_PATTERN so a bad hash never reaches fetch. */
const WORKSPACE_ID = /^w_[A-Za-z0-9_-]{1,64}$/;
const URI_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/;
/** Characters that make a token a shell pattern or quoted prose, not a path. */
const NOT_IN_A_PATH = /[*?|\\<>"'`\s]/;
const TRAILING_POSITION = /^(.+?):(\d+)(?::\d+)?$/;

/**
 * Extensions a bare token must end in to be treated as a file reference.
 *
 * A whitelist, not "any extension": it is the single rule that keeps
 * `s/old/new` and `p50/p99` from becoming dead links, and it costs only an
 * occasional missed reference to a file type nobody previews anyway.
 */
const PATH_EXTENSIONS = new Set([
  'rs',
  'py',
  'pyi',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'md',
  'txt',
  'log',
  'csv',
  'tsv',
  'parquet',
  'db',
  'sqlite',
  'png',
  'svg',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'html',
  'xml',
  'sh',
  'bash',
  'sql',
  'ipynb',
  'lock',
  'cfg',
  'ini',
  'proto',
  'cu',
  'cuh',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
]);

function splitTrailingPosition(token: string): { path: string; line: number | null } {
  const match = TRAILING_POSITION.exec(token);
  if (!match) return { path: token, line: null };
  const line = Number(match[2]);
  return Number.isSafeInteger(line) && line > 0
    ? { path: match[1]!, line }
    : { path: token, line: null };
}

function hasTraversal(path: string): boolean {
  return path.split('/').some((segment) => segment === '..');
}

/**
 * Classify an explicit Markdown link destination.
 *
 * `/workspace/...` is the container path an Agent copies out of its own run
 * output. It is a workspace file, not a site-absolute URL — resolving it as the
 * latter is what made these links 404.
 */
export function classifyLinkTarget(raw: string): LinkTarget {
  const value = raw.trim();
  if (!value) return { kind: 'plain' };
  if (value.startsWith('#')) return { kind: 'app', hash: value };
  if (value.startsWith('//')) return { kind: 'external', href: value };
  if (URI_SCHEME.test(value)) return { kind: 'external', href: value };
  const { path, line } = splitTrailingPosition(value);
  if (!path || hasTraversal(path)) return { kind: 'plain' };
  return { kind: 'workspace-file', path, line };
}

/**
 * Decide whether a bare prose/inline-code token is a file reference.
 *
 * Conservative by construction: no whitespace, no shell metacharacters, must
 * carry a directory separator, and must end in a known extension (or in `/`,
 * marking a directory).
 */
export function detectPathToken(raw: string): LinkTarget {
  const value = raw.trim();
  if (!value || NOT_IN_A_PATH.test(value)) return { kind: 'plain' };
  if (value.startsWith('-')) return { kind: 'plain' };
  if (URI_SCHEME.test(value)) return { kind: 'plain' };
  const { path, line } = splitTrailingPosition(value);
  if (!path.includes('/') || hasTraversal(path)) return { kind: 'plain' };
  if (path.endsWith('/')) {
    return path.length > 1 ? { kind: 'workspace-file', path, line: null } : { kind: 'plain' };
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  // `dot <= 0` also rejects dotfiles (`.env`), which the backend refuses anyway.
  if (dot <= 0) return { kind: 'plain' };
  if (!PATH_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())) return { kind: 'plain' };
  return { kind: 'workspace-file', path, line };
}

export function filePreviewHash(ref: WorkspaceFileRef): string {
  const query = new URLSearchParams({ workspace: ref.workspaceId, path: ref.path });
  if (ref.line !== null) query.set('line', String(ref.line));
  return `${FILE_ROUTE}?${query.toString()}`;
}

export function fileRefFromHash(hash: string): WorkspaceFileRef | null {
  const [route, queryString = ''] = hash.split('?', 2);
  if (route !== FILE_ROUTE) return null;
  const query = new URLSearchParams(queryString);
  const workspaceId = query.get('workspace');
  const path = query.get('path');
  if (!workspaceId || !WORKSPACE_ID.test(workspaceId)) return null;
  if (!path || hasTraversal(path)) return null;
  const rawLine = query.get('line');
  const line = rawLine === null ? null : Number(rawLine);
  if (line !== null && (!Number.isSafeInteger(line) || line <= 0)) return null;
  return { workspaceId, path, line };
}

export function fileName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed;
}

/**
 * Ancestor directories of a path, outermost first, as `{label, path}` pairs
 * ready for a breadcrumb. The file itself is not included.
 */
export function pathAncestors(path: string): readonly { label: string; path: string }[] {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const segments = trimmed.split('/').filter((segment) => segment && segment !== '.');
  return segments.slice(0, -1).map((label, index) => ({
    label,
    path: segments.slice(0, index + 1).join('/'),
  }));
}
