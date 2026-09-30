/**
 * Where a workspace's Analyzer answers.
 *
 * Every workspace is served by the Analyzer behind `/api/analyzer/v1/` except
 * the ones a page registers here: the browser's own results (`w_browser`) are
 * analyzed and served in a worker, which answers the same URLs with the same
 * bodies. The two reads (`fetchArtifact`, `fetchSequence`) ask this for the
 * ref's workspace, so a panel never knows which one answered. A page that
 * embeds the result pages with no Analyzer server behind it (the Intro site)
 * also sets the fallback, which answers every ref no workspace claims.
 */
import type { ArtifactRef, SeqRef } from './ref';

/** `fetch`'s shape, narrowed to what the reads use. */
export type Transport = (url: string, init: { signal?: AbortSignal }) => Promise<Response>;

const serverTransport: Transport = (url, { signal }) =>
  fetch(url, { signal, headers: { accept: 'application/json' } });

const transports = new Map<string, Transport>();
let fallback: Transport | null = null;

/** Serve `workspace` with `transport` until the returned function is called. */
export function registerWorkspaceTransport(workspace: string, transport: Transport): () => void {
  transports.set(workspace, transport);
  return () => {
    if (transports.get(workspace) === transport) transports.delete(workspace);
  };
}

/**
 * Serve every ref no registered workspace claims, a GPU's hardware spec
 * included, with `transport` until the returned function is called.
 */
export function setFallbackTransport(transport: Transport): () => void {
  fallback = transport;
  return () => {
    if (fallback === transport) fallback = null;
  };
}

/**
 * The workspace a ref reads from, or null for one that belongs to none (a
 * GPU's hardware spec), which the fallback or the server answers.
 */
export function refWorkspace(ref: ArtifactRef | SeqRef): string | null {
  if ('kind' in ref && ref.kind === 'catalog') return ref.workspace;
  if ('result' in ref) return ref.result.workspace;
  return null;
}

export function transportFor(ref: ArtifactRef | SeqRef): Transport {
  const workspace = refWorkspace(ref);
  return (
    (workspace === null ? undefined : transports.get(workspace)) ?? fallback ?? serverTransport
  );
}
