/** Stable Perfetto embedding boundary. Keep URL validation and wire details out
 * of React so future self-hosted viewers can replace this bridge in one place. */
export const PERFETTO_EMBED_URL = 'https://ui.perfetto.dev/#!/?mode=embedded';
export const PERFETTO_ORIGIN = new URL(PERFETTO_EMBED_URL).origin;

export type TraceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Analyzer trace resources are private run artifacts. The host page, rather
 * than the cross-origin Perfetto iframe, must fetch them from its own origin. */
export function resolveSameOriginTraceUrl(traceHref: string, pageHref: string): URL {
  const pageUrl = new URL(pageHref);
  const traceUrl = new URL(traceHref, pageUrl);
  if (!['http:', 'https:'].includes(traceUrl.protocol) || traceUrl.origin !== pageUrl.origin) {
    throw new Error('Perfetto trace resources must resolve to the visualization origin.');
  }
  return traceUrl;
}

export async function fetchTraceBuffer(
  fetchTrace: TraceFetch,
  traceUrl: URL,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetchTrace(traceUrl, { credentials: 'same-origin', signal });
  if (!response.ok) {
    throw new Error(`Trace request failed with HTTP ${response.status}.`);
  }
  return response.arrayBuffer();
}

export function traceFileName(traceUrl: URL): string {
  const encodedName = traceUrl.pathname.split('/').filter(Boolean).at(-1);
  if (encodedName === undefined) return 'run.pftrace';
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return encodedName;
  }
}
