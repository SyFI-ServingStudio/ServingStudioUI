import {
  parseAnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalogEntry,
} from '../contracts/analyzer/v1/runCatalog';
import { parseAnalyzerV1RunDescriptor } from '../contracts/analyzer/v1/runDescriptor';
import { parseAnalyzerV1RunSummary } from '../contracts/analyzer/v1/runSummary';
import { decodeAnalyzerV1SubjectPayload } from '../contracts/analyzer/v1/subjectDecoders';
import { parseAnalyzerV1TopologyArtifact } from '../contracts/analyzer/v1/topologyArtifact';
import type {
  DetailArtifact,
  RunDescriptor,
  RunListItem,
  SubjectArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { Topology } from '../domain/run';
import type { SubjectName, SubjectResult, SubjectStatus } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import type { Iteration, IterTimeline } from '../data/iterations';
import type { CostTree } from '../data/tree';
import type { AnalyzerRepository } from './AnalyzerRepository';
import {
  HttpAnalyzerTransportError,
  HttpJsonClient,
  type AnalyzerFetch,
} from './http/HttpJsonClient';

type NonReadySubjectArtifact = Exclude<SubjectArtifact, { status: 'ready' }>;

interface BoundHttpRun {
  catalogEntry: AnalyzerV1RunCatalogEntry;
  descriptor: RunDescriptor;
  descriptorUrl: URL;
}

export interface HttpAnalyzerRepositoryOptions {
  /** Same-origin protocol root, normally `/api/v1/` behind the Vite proxy. */
  apiBaseUrl?: string | URL;
  fetch?: AnalyzerFetch;
}

export class UnknownHttpAnalyzerRunError extends Error {
  constructor(readonly runId: string) {
    super(`Analyzer service catalog has no run with opaque id ${runId}.`);
    this.name = 'UnknownHttpAnalyzerRunError';
  }
}

export class HttpRunBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpRunBindingError';
  }
}

export class HttpDetailUnavailableError extends Error {
  constructor(
    readonly detailName: string,
    readonly status: DetailArtifact['status'] | SubjectStatus,
    message: string,
  ) {
    super(message);
    this.name = 'HttpDetailUnavailableError';
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return error instanceof HttpAnalyzerTransportError ? error.code : 'http_repository_failure';
}

function subjectTransportFailure<Name extends SubjectName>(
  subject: Name,
  error: unknown,
): SubjectResult<Name> {
  return {
    subject,
    status: 'failed',
    code: errorCode(error),
    reason: errorDetail(error),
  } as SubjectResult<Name>;
}

function nonReadySubject<Name extends SubjectName>(
  subject: Name,
  artifact: NonReadySubjectArtifact,
): SubjectResult<Name> {
  return { subject, ...artifact } as SubjectResult<Name>;
}

/** Live analyzer transport. Discovery and hrefs come only from the HTTP
 * catalog/descriptor; every payload still passes through the same analyzer-v1
 * decoder used by checked-in artifacts. */
export class HttpAnalyzerRepository implements AnalyzerRepository {
  private readonly client: HttpJsonClient;
  private readonly catalogUrl: URL;
  private catalog: AnalyzerV1RunCatalog | undefined;
  private catalogRefresh: Promise<AnalyzerV1RunCatalog> | undefined;
  private readonly bindings = new Map<string, BoundHttpRun>();
  private readonly bindingRefreshes = new Map<string, Promise<BoundHttpRun>>();

  constructor(options: HttpAnalyzerRepositoryOptions = {}) {
    this.client = new HttpJsonClient(options.apiBaseUrl ?? '/api/v1/', options.fetch);
    this.catalogUrl = this.client.endpoint('runs');
  }

  async listRuns(): Promise<readonly RunListItem[]> {
    const catalog = await this.refreshCatalog();
    return catalog.runs.map((entry) => ({
      runId: entry.runId,
      kind: entry.kind,
      displayName: entry.displayName,
      lifecycle: entry.lifecycle,
    }));
  }

  async getRunDescriptor(runId: string): Promise<RunDescriptor> {
    return (await this.refreshBinding(runId)).descriptor;
  }

  async getRunSummary(runId: string) {
    const binding = await this.bindRun(runId);
    const input = await this.client.readJson(
      this.client.resolve(binding.descriptorUrl, binding.descriptor.summary.href),
    );
    return parseAnalyzerV1RunSummary(input);
  }

  async getRunTopology(runId: string): Promise<Topology> {
    const binding = await this.bindRun(runId);
    const topology = binding.descriptor.topology;
    if (topology === undefined) {
      throw new HttpRunBindingError(
        `HTTP run ${runId} does not declare its required bounded topology artifact.`,
      );
    }
    const input = await this.client.readJson(
      this.client.resolve(binding.descriptorUrl, topology.href),
    );
    return parseAnalyzerV1TopologyArtifact(input, binding.descriptor.deployment);
  }

  async getSubject<Name extends SubjectName>(
    runId: string,
    subject: Name,
  ): Promise<SubjectResult<Name>> {
    let binding: BoundHttpRun;
    try {
      binding = await this.bindRun(runId);
    } catch (error) {
      return subjectTransportFailure(subject, error);
    }

    const artifact = binding.descriptor.subjects[subject];
    if (artifact === undefined) {
      return {
        subject,
        status: 'not_generated',
        reason: `Run descriptor does not declare analyzer subject ${subject}.`,
      } as SubjectResult<Name>;
    }
    if (artifact.status !== 'ready') return nonReadySubject(subject, artifact);
    if (artifact.payload === undefined) {
      return {
        subject,
        status: 'incompatible',
        reason: `Ready analyzer subject ${subject} has no visualization payload artifact.`,
        receivedSchemaVersion: artifact.schemaVersion,
      } as SubjectResult<Name>;
    }

    try {
      const input = await this.client.readJson(
        this.client.resolve(binding.descriptorUrl, artifact.payload.href),
      );
      const decoded = decodeAnalyzerV1SubjectPayload(subject, input);
      if (decoded.status === 'unavailable') {
        return {
          subject,
          status: 'incompatible',
          receivedSchemaVersion: artifact.schemaVersion,
          reason: `Descriptor marks ${subject} ready, but its payload declares unavailable: ${decoded.reason}`,
        } as SubjectResult<Name>;
      }
      if (decoded.status === 'ready' && decoded.schemaVersion !== artifact.schemaVersion) {
        return {
          subject,
          status: 'incompatible',
          receivedSchemaVersion: decoded.schemaVersion,
          reason: `Descriptor declares ${subject} schema v${artifact.schemaVersion}, but payload decoded as v${decoded.schemaVersion}.`,
        } as SubjectResult<Name>;
      }
      return decoded;
    } catch (error) {
      return subjectTransportFailure(subject, error);
    }
  }

  async getWorkerCostTree(runId: string, _worker: WorkerRef): Promise<CostTree> {
    const descriptor = await this.bindRun(runId).then((binding) => binding.descriptor);
    throw this.detailUnavailable(runId, 'worker-cost-tree', descriptor);
  }

  async getWorkerTimeline(runId: string, _worker: WorkerRef): Promise<IterTimeline> {
    const descriptor = await this.bindRun(runId).then((binding) => binding.descriptor);
    throw this.detailUnavailable(runId, 'worker-iteration-index', descriptor);
  }

  async getIteration(runId: string, _worker: WorkerRef, _iterationId: string): Promise<Iteration> {
    const descriptor = await this.bindRun(runId).then((binding) => binding.descriptor);
    throw this.detailUnavailable(runId, 'iteration-detail', descriptor);
  }

  async getTrace(runId: string, traceName: string): Promise<TraceResource> {
    let binding: BoundHttpRun;
    try {
      binding = await this.bindRun(runId);
    } catch (error) {
      return { status: 'failed', code: errorCode(error), reason: errorDetail(error) };
    }
    const trace = binding.descriptor.traces[traceName];
    if (trace === undefined) {
      return {
        status: 'not_generated',
        reason: `Run descriptor does not declare trace ${traceName}.`,
      };
    }
    if (trace.status !== 'ready') return trace;
    try {
      const address = this.client.resolve(binding.descriptorUrl, trace.artifact.href).href;
      return { status: 'ready', artifact: { ...trace.artifact, href: address } };
    } catch (error) {
      return { status: 'failed', code: errorCode(error), reason: errorDetail(error) };
    }
  }

  private refreshCatalog(): Promise<AnalyzerV1RunCatalog> {
    if (this.catalogRefresh !== undefined) return this.catalogRefresh;
    const refresh = this.client
      .readJson(this.catalogUrl)
      .then(parseAnalyzerV1RunCatalog)
      .then((catalog) => {
        const nextEntries = new Map(catalog.runs.map((entry) => [entry.runId, entry]));
        for (const [runId, binding] of this.bindings) {
          const next = nextEntries.get(runId);
          if (next === undefined || next.descriptorHref !== binding.catalogEntry.descriptorHref) {
            this.bindings.delete(runId);
          }
        }
        this.catalog = catalog;
        return catalog;
      })
      .finally(() => {
        if (this.catalogRefresh === refresh) this.catalogRefresh = undefined;
      });
    this.catalogRefresh = refresh;
    return refresh;
  }

  private async catalogEntry(runId: string): Promise<AnalyzerV1RunCatalogEntry> {
    const cached = this.catalog?.runs.find((entry) => entry.runId === runId);
    if (cached !== undefined) return cached;
    const catalog = await this.refreshCatalog();
    const entry = catalog.runs.find((candidate) => candidate.runId === runId);
    if (entry === undefined) throw new UnknownHttpAnalyzerRunError(runId);
    return entry;
  }

  private bindRun(runId: string): Promise<BoundHttpRun> {
    const cached = this.bindings.get(runId);
    return cached === undefined ? this.refreshBinding(runId) : Promise.resolve(cached);
  }

  private refreshBinding(runId: string): Promise<BoundHttpRun> {
    const current = this.bindingRefreshes.get(runId);
    if (current !== undefined) return current;
    const refresh = this.catalogEntry(runId)
      .then(async (catalogEntry) => {
        const descriptorUrl = this.client.resolve(this.catalogUrl, catalogEntry.descriptorHref);
        const descriptor = parseAnalyzerV1RunDescriptor(await this.client.readJson(descriptorUrl));
        if (descriptor.runId !== runId) {
          throw new HttpRunBindingError(
            `Descriptor run id ${descriptor.runId} does not match requested opaque id ${runId}.`,
          );
        }
        const binding = { catalogEntry, descriptor, descriptorUrl };
        this.bindings.set(runId, binding);
        return binding;
      })
      .finally(() => {
        if (this.bindingRefreshes.get(runId) === refresh) this.bindingRefreshes.delete(runId);
      });
    this.bindingRefreshes.set(runId, refresh);
    return refresh;
  }

  private detailUnavailable(
    runId: string,
    detailName: string,
    descriptor: RunDescriptor,
  ): HttpDetailUnavailableError {
    const detail = descriptor.details[detailName];
    if (detail === undefined) {
      return new HttpDetailUnavailableError(
        detailName,
        'not_generated',
        `Run ${runId} does not declare detail resource ${detailName}.`,
      );
    }
    if (detail.status === 'ready') {
      return new HttpDetailUnavailableError(
        detailName,
        'incompatible',
        `Run ${runId} declares ${detailName} ready, but this UI has no protocol-v1 detail decoder.`,
      );
    }
    const reason = 'reason' in detail && detail.reason ? `: ${detail.reason}` : '';
    return new HttpDetailUnavailableError(
      detailName,
      detail.status,
      `Run ${runId} detail ${detailName} is ${detail.status}${reason}`,
    );
  }
}
