import {
  parseAnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalogEntry,
} from '../contracts/analyzer/v1/runCatalog';
import { parseAnalyzerV1RunDescriptor } from '../contracts/analyzer/v1/runDescriptor';
import { parseAnalyzerV1RunSummary } from '../contracts/analyzer/v1/runSummary';
import { parseAnalyzerV1KernelThroughputAnalysis } from '../contracts/analyzer/v1/kernelThroughputAnalysis';
import {
  decodeAnalyzerV1IterationOptimalityKernelLadder,
  decodeAnalyzerV1IterationOptimalityWaterfall,
} from '../contracts/analyzer/v1/optimality';
import { decodeAnalyzerV1SubjectPayload } from '../contracts/analyzer/v1/subjectDecoders';
import { parseAnalyzerV1TopologyArtifact } from '../contracts/analyzer/v1/topologyArtifact';
import {
  parseAnalyzerV1ModelResource,
  parseAnalyzerV1WorkloadResource,
} from '../contracts/analyzer/v1/overviewResources';
import {
  parseAnalyzerV1WorkerCostTree,
  parseAnalyzerV1WorkerOperationRange,
  parseAnalyzerV1WorkerOperationSeek,
} from '../contracts/analyzer/v1/workerOperation';
import {
  parseAnalyzerV1SweepCatalog,
  parseAnalyzerV1SweepPayload,
  type AnalyzerV1SweepCatalog,
} from '../contracts/analyzer/v1/sweep';
import type {
  DetailArtifact,
  RunDescriptor,
  RunListItem,
  SubjectArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { Topology } from '../domain/run';
import type { OptimalityMode } from '../domain/optimality';
import type { SubjectName, SubjectResult, SubjectStatus } from '../domain/subject';
import type { WorkerRef } from '../domain/worker';
import type { WorkerCostTreeRef } from '../domain/workerOperation';
import type { AnalyzerRepository } from './AnalyzerRepository';
import {
  HttpAnalyzerTransportError,
  HttpJsonClient,
  type AnalyzerFetch,
} from './http/HttpJsonClient';
import {
  currentTimelineInteractionId,
  timelineProfileEvent,
} from '../application/timelineProfiling';

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

function routeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpRunBindingError(`${label} is not a safe Analyzer route segment.`);
  }
  return value;
}

/** Live analyzer transport. Discovery and hrefs come only from the HTTP
 * catalog/descriptor; every payload still passes through the same analyzer-v1
 * decoder used by checked-in artifacts. */
export class HttpAnalyzerRepository implements AnalyzerRepository {
  private readonly client: HttpJsonClient;
  private readonly catalogUrl: URL;
  private readonly sweepCatalogUrl: URL;
  private catalog: AnalyzerV1RunCatalog | undefined;
  private sweepCatalog: AnalyzerV1SweepCatalog | undefined;
  private catalogRefresh: Promise<AnalyzerV1RunCatalog> | undefined;
  private readonly bindings = new Map<string, BoundHttpRun>();
  private readonly bindingRefreshes = new Map<string, Promise<BoundHttpRun>>();

  constructor(options: HttpAnalyzerRepositoryOptions = {}) {
    this.client = new HttpJsonClient(options.apiBaseUrl ?? '/api/v1/', options.fetch);
    this.catalogUrl = this.client.endpoint('runs');
    this.sweepCatalogUrl = this.client.endpoint('sweeps');
  }

  async listRuns(): Promise<readonly RunListItem[]> {
    const catalog = await this.refreshCatalog();
    return catalog.runs.map((entry) => ({
      workspaceId: entry.workspaceId,
      runId: entry.runId,
      kind: entry.kind,
      displayName: entry.displayName,
      lifecycle: entry.lifecycle,
    }));
  }

  async listSweeps() {
    const catalog = await this.refreshSweepCatalog();
    return catalog.sweeps.map(({ payloadHref: _payloadHref, ...sweep }) => sweep);
  }

  async getSweep(sweepId: string) {
    const catalog = this.sweepCatalog ?? (await this.refreshSweepCatalog());
    const entry = catalog.sweeps.find((sweep) => sweep.sweepId === sweepId);
    if (entry === undefined) {
      throw new HttpRunBindingError(`Analyzer service catalog has no sweep ${sweepId}.`);
    }
    const payloadUrl = this.client.resolve(this.sweepCatalogUrl, entry.payloadHref);
    const payload = parseAnalyzerV1SweepPayload(await this.client.readJson(payloadUrl));
    if (payload.sweepId !== sweepId) {
      throw new HttpRunBindingError(
        `Sweep payload id ${payload.sweepId} does not match requested opaque id ${sweepId}.`,
      );
    }
    return payload;
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

  async getRunModel(runId: string) {
    const binding = await this.bindRun(runId);
    const model = binding.descriptor.model;
    if (model === undefined) {
      throw new HttpRunBindingError(`HTTP run ${runId} does not declare a model resource.`);
    }
    const input = await this.client.readJson(
      this.client.resolve(binding.descriptorUrl, model.href),
    );
    return parseAnalyzerV1ModelResource(input);
  }

  async getRunWorkload(runId: string) {
    const binding = await this.bindRun(runId);
    const workload = binding.descriptor.workload;
    if (workload === undefined) {
      throw new HttpRunBindingError(`HTTP run ${runId} does not declare a workload resource.`);
    }
    const input = await this.client.readJson(
      this.client.resolve(binding.descriptorUrl, workload.href),
    );
    return parseAnalyzerV1WorkloadResource(input);
  }

  async getSubject<Name extends SubjectName>(
    runId: string,
    subject: Name,
    variant?: string,
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
    const selectedVariant = variant === undefined ? artifact : artifact.variants?.[variant];
    if (selectedVariant === undefined) {
      return {
        subject,
        status: 'not_generated',
        reason: `Analyzer subject ${subject} does not declare variant ${variant}.`,
      } as SubjectResult<Name>;
    }
    const selectedPayload = 'payload' in selectedVariant ? selectedVariant.payload : undefined;
    if (selectedPayload === undefined) {
      return {
        subject,
        status: 'incompatible',
        reason: `Ready analyzer subject ${subject} has no visualization payload artifact.`,
        receivedSchemaVersion: artifact.schemaVersion,
      } as SubjectResult<Name>;
    }

    try {
      const input = await this.client.readJson(
        this.client.resolve(binding.descriptorUrl, selectedPayload.href),
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

  async getWorkerOperations(
    runId: string,
    worker: WorkerRef,
    page: { offset: number; limit: number },
  ) {
    const interactionId = currentTimelineInteractionId();
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-operation-index', binding.descriptor);
    const poolTag = routeSegment(worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(worker.workerId, 'Worker id');
    const path = `workers/${poolTag}/${workerId}/operations?offset=${page.offset}&limit=${page.limit}`;
    const input = await this.client.readJson(this.client.resolve(binding.descriptorUrl, path));
    const decodeStartedAt = performance.now();
    timelineProfileEvent('repository-page-decode-start', { poolTag, workerId }, interactionId);
    const decoded = parseAnalyzerV1WorkerOperationRange(input, worker);
    timelineProfileEvent(
      'repository-page-decode-end',
      { poolTag, workerId, durationMs: performance.now() - decodeStartedAt },
      interactionId,
    );
    return decoded;
  }

  async getWorkerOperationSeek(runId: string, worker: WorkerRef, atMs: number, limit: number) {
    const interactionId = currentTimelineInteractionId();
    if (!Number.isFinite(atMs) || atMs < 0) {
      throw new HttpRunBindingError('Worker operation seek time must be finite and non-negative.');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 384) {
      throw new HttpRunBindingError(
        'Worker operation seek limit must be an integer from 1 to 384.',
      );
    }
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-operation-index', binding.descriptor);
    const poolTag = routeSegment(worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(worker.workerId, 'Worker id');
    const path = `workers/${poolTag}/${workerId}/operations/seek?at_ms=${encodeURIComponent(String(atMs))}`;
    const input = await this.client.readJson(this.client.resolve(binding.descriptorUrl, path));
    const decodeStartedAt = performance.now();
    timelineProfileEvent('repository-seek-decode-start', { poolTag, workerId }, interactionId);
    const decoded = parseAnalyzerV1WorkerOperationSeek(input, worker, atMs, limit);
    timelineProfileEvent(
      'repository-seek-decode-end',
      { poolTag, workerId, durationMs: performance.now() - decodeStartedAt },
      interactionId,
    );
    return decoded;
  }

  async getWorkerCostTree(runId: string, ref: WorkerCostTreeRef) {
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-cost-tree', binding.descriptor);
    const poolTag = routeSegment(ref.worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(ref.worker.workerId, 'Worker id');
    const iterId = routeSegment(ref.iterId, 'Iteration id');
    const batchId = routeSegment(ref.batchId, 'Batch id');
    const operationId = routeSegment(ref.operationId, 'Operation id');
    const path = `workers/${poolTag}/${workerId}/operations/${iterId}/${batchId}/${operationId}/cost-tree`;
    const input = await this.client.readJson(this.client.resolve(binding.descriptorUrl, path));
    return parseAnalyzerV1WorkerCostTree(input, ref);
  }

  async getKernelThroughputAnalysis(runId: string, ref: WorkerCostTreeRef, leafId: number) {
    if (!Number.isSafeInteger(leafId) || leafId < 0) {
      throw new HttpRunBindingError('Kernel leaf id must be a non-negative safe integer.');
    }
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-cost-tree', binding.descriptor);
    const poolTag = routeSegment(ref.worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(ref.worker.workerId, 'Worker id');
    const iterId = routeSegment(ref.iterId, 'Iteration id');
    const batchId = routeSegment(ref.batchId, 'Batch id');
    const operationId = routeSegment(ref.operationId, 'Operation id');
    const path = `workers/${poolTag}/${workerId}/operations/${iterId}/${batchId}/${operationId}/cost-tree/${leafId}/kernel-throughput-analysis`;
    const input = await this.client.readJson(this.client.resolve(binding.descriptorUrl, path));
    return parseAnalyzerV1KernelThroughputAnalysis(input, ref, leafId);
  }

  async getIterationOptimalityKernelLadder(
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
  ) {
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'iteration-optimality-kernel-ladder', binding.descriptor);
    const poolTag = routeSegment(worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(worker.workerId, 'Worker id');
    const iterationId = routeSegment(iterId, 'Iteration id');
    const path = `workers/${poolTag}/${workerId}/iterations/${iterationId}/optimality-kernel-ladder`;
    const resourceUrl = this.client.resolve(binding.descriptorUrl, path);
    resourceUrl.searchParams.set('mode', mode);
    const input = await this.client.readJson(resourceUrl);
    return decodeAnalyzerV1IterationOptimalityKernelLadder(input, worker, iterId);
  }

  async getIterationOptimalityWaterfall(
    runId: string,
    worker: WorkerRef,
    iterId: string,
    mode: OptimalityMode,
  ) {
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'iteration-optimality-waterfall', binding.descriptor);
    const poolTag = routeSegment(worker.poolTag, 'Worker pool tag');
    const workerId = routeSegment(worker.workerId, 'Worker id');
    const iterationId = routeSegment(iterId, 'Iteration id');
    const path = `workers/${poolTag}/${workerId}/iterations/${iterationId}/optimality-waterfall`;
    const resourceUrl = this.client.resolve(binding.descriptorUrl, path);
    resourceUrl.searchParams.set('mode', mode);
    const input = await this.client.readJson(resourceUrl);
    return decodeAnalyzerV1IterationOptimalityWaterfall(input, worker, iterId);
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

  private async refreshSweepCatalog(): Promise<AnalyzerV1SweepCatalog> {
    const catalog = parseAnalyzerV1SweepCatalog(await this.client.readJson(this.sweepCatalogUrl));
    this.sweepCatalog = catalog;
    return catalog;
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

  private requireReadyDetail(runId: string, detailName: string, descriptor: RunDescriptor): void {
    const detail = descriptor.details[detailName];
    if (detail?.status !== 'ready') throw this.detailUnavailable(runId, detailName, descriptor);
    if (detail.resource.href !== 'workers') {
      throw new HttpDetailUnavailableError(
        detailName,
        'incompatible',
        `Run ${runId} detail ${detailName} must declare resource href base workers.`,
      );
    }
  }
}
