import { analyzerV1ArtifactHrefSchema } from '../../contracts/analyzer/v1/artifactHref';

export type AnalyzerFetch = typeof fetch;

interface CachedJson {
  etag?: string;
  value: unknown;
}

interface ProblemDetails {
  code?: unknown;
  detail?: unknown;
  status?: unknown;
  title?: unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function browserBaseUrl(): string {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof location !== 'undefined' && location.href) return location.href;
  throw new Error('A relative analyzer API base requires a browser base URL.');
}

function directoryUrl(input: string | URL): URL {
  const url = input instanceof URL ? new URL(input) : new URL(input, browserBaseUrl());
  if (url.username || url.password)
    throw new Error('Analyzer API URLs cannot contain credentials.');
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  url.search = '';
  url.hash = '';
  return url;
}

function parseProblem(input: unknown): ProblemDetails | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return input as ProblemDetails;
}

/** Transport failures retain a stable service code so subject queries can fail
 * locally without parsing user-facing prose. */
export class HttpAnalyzerTransportError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | undefined,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'HttpAnalyzerTransportError';
  }
}

/** Same-origin JSON reader with conditional request caching. React Query owns
 * freshness; this layer only turns its refetch into If-None-Match/304 reuse. */
export class HttpJsonClient {
  readonly apiBaseUrl: URL;
  private readonly cache = new Map<string, CachedJson>();
  private readonly fetchImpl: AnalyzerFetch;

  constructor(apiBaseUrl: string | URL, fetchImpl?: AnalyzerFetch) {
    this.apiBaseUrl = directoryUrl(apiBaseUrl);
    // Browser fetch performs a receiver brand check. Keeping the bare
    // `window.fetch` as a class field and later invoking `this.fetchImpl(...)`
    // would bind `this` to HttpJsonClient and throw "Illegal invocation".
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
    const browserOrigin = new URL(browserBaseUrl()).origin;
    if (this.apiBaseUrl.origin !== browserOrigin) {
      throw new Error(
        `Analyzer API must be same-origin (${browserOrigin}), got ${this.apiBaseUrl.origin}.`,
      );
    }
  }

  endpoint(path: string): URL {
    analyzerV1ArtifactHrefSchema.parse(path);
    return this.assertApiUrl(new URL(path, this.apiBaseUrl));
  }

  resolve(containingUrl: URL, href: string): URL {
    analyzerV1ArtifactHrefSchema.parse(href);
    return this.assertApiUrl(new URL(href, containingUrl));
  }

  async readJson(url: URL): Promise<unknown> {
    const address = this.assertApiUrl(url).href;
    const cached = this.cache.get(address);
    const headers = new Headers({ Accept: 'application/json' });
    if (cached?.etag !== undefined) headers.set('If-None-Match', cached.etag);

    let response: Response;
    try {
      response = await this.fetchImpl(address, { headers });
    } catch (error) {
      throw new HttpAnalyzerTransportError(
        'network_error',
        undefined,
        `Could not reach analyzer service at ${address}: ${messageOf(error)}`,
        error,
      );
    }

    if (response.status === 304) {
      if (cached !== undefined) return cached.value;
      throw new HttpAnalyzerTransportError(
        'invalid_not_modified',
        304,
        `Analyzer service returned 304 for uncached resource ${address}.`,
      );
    }
    if (!response.ok) throw await this.responseError(address, response);

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new HttpAnalyzerTransportError(
        'invalid_json',
        response.status,
        `Analyzer resource ${address} did not contain valid JSON: ${messageOf(error)}`,
        error,
      );
    }
    const etag = response.headers.get('ETag') ?? undefined;
    this.cache.set(address, { value, ...(etag === undefined ? {} : { etag }) });
    return value;
  }

  private assertApiUrl(url: URL): URL {
    if (
      url.origin !== this.apiBaseUrl.origin ||
      !url.pathname.startsWith(this.apiBaseUrl.pathname)
    ) {
      throw new HttpAnalyzerTransportError(
        'artifact_outside_api_root',
        undefined,
        `Analyzer resource URL is outside ${this.apiBaseUrl.href}: ${url.href}`,
      );
    }
    return url;
  }

  private async responseError(address: string, response: Response) {
    let problem: ProblemDetails | undefined;
    try {
      problem = parseProblem(await response.json());
    } catch {
      problem = undefined;
    }
    const code = typeof problem?.code === 'string' ? problem.code : 'http_error';
    const detail =
      typeof problem?.detail === 'string'
        ? problem.detail
        : typeof problem?.title === 'string'
          ? problem.title
          : response.statusText || `HTTP ${response.status}`;
    return new HttpAnalyzerTransportError(
      code,
      response.status,
      `Analyzer request ${address} failed: ${detail}`,
    );
  }
}
