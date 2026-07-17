import { analyzerV1ArtifactHrefSchema } from '../../contracts/analyzer/v1/artifactHref';
import {
  currentTimelineInteractionId,
  timelineProfileEvent,
} from '../../application/timelineProfiling';

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

const MAX_CONCURRENT_JSON_REQUESTS = 4;
const MAX_ARTIFACT_BUSY_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 5_000;
const IMF_FIXDATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

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

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const retryAfter = value.trim();
  if (retryAfter === '') return undefined;

  let delayMs: number;
  if (/^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (!Number.isSafeInteger(seconds)) return undefined;
    delayMs = seconds * 1_000;
  } else {
    if (!IMF_FIXDATE_PATTERN.test(retryAfter)) return undefined;
    const retryAt = Date.parse(retryAfter);
    if (!Number.isFinite(retryAt) || new Date(retryAt).toUTCString() !== retryAfter) {
      return undefined;
    }
    delayMs = Math.max(0, retryAt - Date.now());
  }

  // Do not turn a bounded UI read into an arbitrarily long background wait,
  // and never clamp downward because that would retry before the server asked.
  return delayMs <= MAX_RETRY_AFTER_MS ? delayMs : undefined;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/** Client-local admission keeps one UI repository from racing the Analyzer's
 * four fail-fast artifact permits. A retry is deliberately enqueued as a new
 * operation, so it cannot retain a permit while honoring Retry-After. */
class FifoRequestScheduler {
  private activeRequests = 0;
  private readonly activeAddresses = new Set<string>();
  private readonly pendingStarts: Array<() => void> = [];

  constructor(private readonly maxConcurrentRequests: number) {}

  run<T>(address: string, operation: () => Promise<T>): Promise<T> {
    const interactionId = currentTimelineInteractionId();
    const queuedAt = performance.now();
    timelineProfileEvent(
      'http-scheduler-queued',
      {
        resource: diagnosticResource(address),
        activeRequests: this.activeRequests,
        pendingRequests: this.pendingStarts.length,
        activeResources: [...this.activeAddresses].map(diagnosticResource),
      },
      interactionId,
    );
    return new Promise<T>((resolve, reject) => {
      this.pendingStarts.push(() => {
        this.activeRequests += 1;
        this.activeAddresses.add(address);
        timelineProfileEvent(
          'http-scheduler-admitted',
          {
            resource: diagnosticResource(address),
            queueWaitMs: performance.now() - queuedAt,
            activeRequests: this.activeRequests,
            pendingRequests: this.pendingStarts.length,
          },
          interactionId,
        );
        let result: Promise<T>;
        try {
          result = operation();
        } catch (error) {
          result = Promise.reject(error);
        }
        void result.then(resolve, reject).finally(() => {
          this.activeRequests -= 1;
          this.activeAddresses.delete(address);
          timelineProfileEvent(
            'http-scheduler-complete',
            {
              resource: diagnosticResource(address),
              totalMs: performance.now() - queuedAt,
              activeRequests: this.activeRequests,
              pendingRequests: this.pendingStarts.length,
            },
            interactionId,
          );
          this.startPendingRequests();
        });
      });
      this.startPendingRequests();
    });
  }

  private startPendingRequests(): void {
    while (this.activeRequests < this.maxConcurrentRequests && this.pendingStarts.length > 0) {
      this.pendingStarts.shift()?.();
    }
  }
}

function diagnosticResource(address: string): string {
  const url = new URL(address);
  const runResource = url.pathname.match(/\/runs\/[^/]+\/(.*)$/)?.[1];
  return `${runResource ?? url.pathname}${url.search}`;
}

/** Transport failures retain a stable service code so subject queries can fail
 * locally without parsing user-facing prose. */
export class HttpAnalyzerTransportError extends Error {
  constructor(
    readonly code: string,
    readonly status: number | undefined,
    message: string,
    readonly cause?: unknown,
    readonly retryAfterMs?: number,
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
  private readonly requestScheduler = new FifoRequestScheduler(MAX_CONCURRENT_JSON_REQUESTS);

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

    for (let retries = 0; ; retries += 1) {
      try {
        const interactionId = currentTimelineInteractionId();
        return await this.requestScheduler.run(address, () =>
          this.readJsonAttempt(address, interactionId),
        );
      } catch (error) {
        if (
          !(error instanceof HttpAnalyzerTransportError) ||
          error.status !== 503 ||
          error.code !== 'artifact_read_busy' ||
          error.retryAfterMs === undefined ||
          retries >= MAX_ARTIFACT_BUSY_RETRIES
        ) {
          throw error;
        }
        await wait(error.retryAfterMs);
      }
    }
  }

  private async readJsonAttempt(address: string, interactionId: string | null): Promise<unknown> {
    const cached = this.cache.get(address);
    const headers = new Headers({ Accept: 'application/json' });
    if (cached?.etag !== undefined) headers.set('If-None-Match', cached.etag);

    let response: Response;
    const fetchStartedAt = performance.now();
    timelineProfileEvent(
      'http-fetch-start',
      { resource: diagnosticResource(address) },
      interactionId,
    );
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
    timelineProfileEvent(
      'http-fetch-headers',
      {
        resource: diagnosticResource(address),
        durationMs: performance.now() - fetchStartedAt,
        status: response.status,
      },
      interactionId,
    );

    if (response.status === 304) {
      if (cached !== undefined) return cached.value;
      throw new HttpAnalyzerTransportError(
        'invalid_not_modified',
        304,
        `Analyzer service returned 304 for uncached resource ${address}.`,
      );
    }
    if (!response.ok) throw await this.responseError(address, response);

    const bodyStartedAt = performance.now();
    timelineProfileEvent(
      'http-body-text-start',
      { resource: diagnosticResource(address) },
      interactionId,
    );
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new HttpAnalyzerTransportError(
        'invalid_json',
        response.status,
        `Analyzer resource ${address} did not contain valid JSON: ${messageOf(error)}`,
        error,
      );
    }
    timelineProfileEvent(
      'http-body-text-end',
      {
        resource: diagnosticResource(address),
        durationMs: performance.now() - bodyStartedAt,
        bytes: new TextEncoder().encode(body).byteLength,
      },
      interactionId,
    );
    const decodeStartedAt = performance.now();
    timelineProfileEvent(
      'http-json-decode-start',
      { resource: diagnosticResource(address) },
      interactionId,
    );
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch (error) {
      throw new HttpAnalyzerTransportError(
        'invalid_json',
        response.status,
        `Analyzer resource ${address} did not contain valid JSON: ${messageOf(error)}`,
        error,
      );
    }
    timelineProfileEvent(
      'http-json-decode-end',
      {
        resource: diagnosticResource(address),
        durationMs: performance.now() - decodeStartedAt,
      },
      interactionId,
    );
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
      undefined,
      parseRetryAfterMs(response.headers.get('Retry-After')),
    );
  }
}
