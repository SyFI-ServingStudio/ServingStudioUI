/**
 * Where the Analyzer answers.
 *
 * Every read is served by the Analyzer behind `/api/analyzer/v1/` unless a
 * page sets the fallback: a page that embeds the result pages with no
 * Analyzer server behind it (the Intro site) answers every read, a GPU's
 * hardware spec included, itself. The two reads (`fetchArtifact`,
 * `fetchSequence`) ask this for their transport, so a panel never knows which
 * one answered.
 */

/** `fetch`'s shape, narrowed to what the reads use. */
export type Transport = (url: string, init: { signal?: AbortSignal }) => Promise<Response>;

const serverTransport: Transport = (url, { signal }) =>
  fetch(url, { signal, headers: { accept: 'application/json' } });

let fallback: Transport | null = null;

/** Serve every read with `transport` until the returned function is called. */
export function setFallbackTransport(transport: Transport): () => void {
  fallback = transport;
  return () => {
    if (fallback === transport) fallback = null;
  };
}

export function activeTransport(): Transport {
  return fallback ?? serverTransport;
}
