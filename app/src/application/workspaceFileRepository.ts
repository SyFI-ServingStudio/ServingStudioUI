/**
 * Read files out of one workspace through the conversation backend's
 * `/api/file*` routes.
 *
 * Owns URL construction and transport errors so features never build an
 * `/api/file` query string themselves. The backend classifies each path
 * (`preview_kind`, `language`) and bounds every read; this module carries that
 * verdict through rather than guessing a second time in the browser.
 */

export type FilePreviewKind = 'image' | 'text' | 'binary' | 'directory';

export interface WorkspaceFileMeta {
  workspaceId: string;
  path: string;
  name: string;
  size: number;
  mtime: number;
  isDir: boolean;
  previewKind: FilePreviewKind;
  language: string | null;
  previewByteLimit: number;
}

export interface WorkspaceFileText {
  text: string;
  truncated: boolean;
  totalBytes: number;
}

export interface WorkspaceDirectoryEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
  isDir: boolean;
  previewKind: FilePreviewKind;
}

/** Carries the HTTP status so a page can tell "denied" from "gone". */
export class WorkspaceFileError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WorkspaceFileError';
    this.status = status;
  }
}

function fileQuery(workspaceId: string, path: string): string {
  return new URLSearchParams({ path, workspace_id: workspaceId }).toString();
}

/** Direct content URL — the `src` of an `<img>`, the target of a download. */
export function fileContentUrl(workspaceId: string, path: string): string {
  return `/api/file?${fileQuery(workspaceId, path)}`;
}

async function requireOk(response: Response, action: string): Promise<Response> {
  if (response.ok) return response;
  const detail = await response
    .json()
    .then((body: unknown) =>
      body !== null &&
      typeof body === 'object' &&
      typeof (body as { detail?: unknown }).detail === 'string'
        ? (body as { detail: string }).detail
        : null,
    )
    .catch(() => null);
  throw new WorkspaceFileError(response.status, detail ?? `${action} failed (${response.status})`);
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function previewKindFrom(value: unknown): FilePreviewKind {
  return value === 'image' || value === 'text' || value === 'directory' ? value : 'binary';
}

function metaFromWire(value: unknown): WorkspaceFileMeta {
  const source = recordFrom(value);
  if (
    typeof source.workspace_id !== 'string' ||
    typeof source.path !== 'string' ||
    typeof source.name !== 'string' ||
    typeof source.size !== 'number' ||
    typeof source.is_dir !== 'boolean'
  ) {
    throw new WorkspaceFileError(502, 'File metadata has an invalid shape');
  }
  return {
    workspaceId: source.workspace_id,
    path: source.path,
    name: source.name,
    size: source.size,
    mtime: typeof source.mtime === 'number' ? source.mtime : 0,
    isDir: source.is_dir,
    previewKind: previewKindFrom(source.preview_kind),
    language: typeof source.language === 'string' ? source.language : null,
    previewByteLimit: typeof source.preview_byte_limit === 'number' ? source.preview_byte_limit : 0,
  };
}

function entryFromWire(value: unknown): WorkspaceDirectoryEntry | null {
  const source = recordFrom(value);
  if (typeof source.path !== 'string' || typeof source.name !== 'string') return null;
  return {
    path: source.path,
    name: source.name,
    size: typeof source.size === 'number' ? source.size : 0,
    mtime: typeof source.mtime === 'number' ? source.mtime : 0,
    isDir: source.is_dir === true,
    previewKind: previewKindFrom(source.preview_kind),
  };
}

export async function getFileMeta(workspaceId: string, path: string): Promise<WorkspaceFileMeta> {
  const response = await requireOk(
    await fetch(`/api/file/meta?${fileQuery(workspaceId, path)}`),
    'Load file metadata',
  );
  return metaFromWire(await response.json());
}

export async function getFileText(workspaceId: string, path: string): Promise<WorkspaceFileText> {
  const response = await requireOk(await fetch(fileContentUrl(workspaceId, path)), 'Load file');
  const totalBytes = Number(response.headers.get('X-File-Total-Bytes') ?? '0');
  return {
    text: await response.text(),
    truncated: response.headers.get('X-File-Truncated') === '1',
    totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
  };
}

export async function listDirectory(
  workspaceId: string,
  path: string,
): Promise<readonly WorkspaceDirectoryEntry[]> {
  const response = await requireOk(
    await fetch(`/api/file/list?${fileQuery(workspaceId, path)}`),
    'List directory',
  );
  const payload = recordFrom(await response.json());
  return Array.isArray(payload.files)
    ? payload.files.flatMap((value) => {
        const entry = entryFromWire(value);
        return entry ? [entry] : [];
      })
    : [];
}
