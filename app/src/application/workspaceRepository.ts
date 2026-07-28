export interface WorkspaceSummary {
  workspaceId: string;
  displayName: string;
  state: 'active' | 'archived';
  storageKind: 'external' | 'managed';
  createdAt: number;
  lastAccessedAt: number;
}

interface WorkspaceListResponse {
  workspaces?: readonly unknown[];
}

function requireResponse(response: Response, action: string): Response {
  if (!response.ok) throw new Error(`${action} failed (${response.status})`);
  return response;
}

function workspaceFromWire(input: unknown): WorkspaceSummary {
  if (input === null || typeof input !== 'object') {
    throw new Error('Workspace response is not an object');
  }
  const value = input as Record<string, unknown>;
  const workspaceId = value.workspace_id;
  const displayName = value.display_name;
  const state = value.state;
  const storageKind = value.storage_kind;
  const createdAt = value.created_at;
  const lastAccessedAt = value.last_accessed_at;
  if (
    typeof workspaceId !== 'string' ||
    typeof displayName !== 'string' ||
    (state !== 'active' && state !== 'archived') ||
    (storageKind !== 'external' && storageKind !== 'managed') ||
    typeof createdAt !== 'number' ||
    typeof lastAccessedAt !== 'number'
  ) {
    throw new Error('Workspace response has an invalid shape');
  }
  return { workspaceId, displayName, state, storageKind, createdAt, lastAccessedAt };
}

export async function listWorkspaces(): Promise<readonly WorkspaceSummary[]> {
  const response = requireResponse(await fetch('/api/workspaces'), 'List workspaces');
  const payload = (await response.json()) as WorkspaceListResponse;
  if (!Array.isArray(payload.workspaces)) return [];
  return payload.workspaces.map(workspaceFromWire);
}

export async function createWorkspace(displayName: string): Promise<WorkspaceSummary> {
  const response = requireResponse(
    await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    }),
    'Create workspace',
  );
  return workspaceFromWire(await response.json());
}

export async function renameWorkspace(
  workspaceId: string,
  displayName: string,
): Promise<WorkspaceSummary> {
  const response = requireResponse(
    await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    }),
    'Rename workspace',
  );
  return workspaceFromWire(await response.json());
}
