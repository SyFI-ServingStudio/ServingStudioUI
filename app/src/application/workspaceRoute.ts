const DEFAULT_WORKSPACE_ID = 'w_main';

/** Workspace identity is part of the hash because the Analyzer is a hash-routed
 * application. Search parameters remain reserved for deployment concerns. */
export function workspaceIdFromLocation(
  hash = window.location.hash,
  search = window.location.search,
): string {
  const [, hashQuery = ''] = hash.split('?', 2);
  const fromHash = new URLSearchParams(hashQuery).get('workspace');
  if (fromHash) return fromHash;
  return new URLSearchParams(search).get('workspace') || DEFAULT_WORKSPACE_ID;
}

export function agentWorkspaceHref(workspaceId: string): string {
  const query = new URLSearchParams({ workspace: workspaceId });
  return `#/agent?${query.toString()}`;
}
