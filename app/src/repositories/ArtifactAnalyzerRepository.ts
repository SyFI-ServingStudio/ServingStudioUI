import {
  parseAnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalog,
  type AnalyzerV1RunCatalogEntry,
} from '../contracts/analyzer/v1/runCatalog';
import { parseAnalyzerV1RunDescriptor } from '../contracts/analyzer/v1/runDescriptor';
import { parseAnalyzerV1RunSummary } from '../contracts/analyzer/v1/runSummary';
import { decodeAnalyzerV1SubjectPayload } from '../contracts/analyzer/v1/subjectDecoders';
import { parseAnalyzerV1Topology } from '../contracts/analyzer/v1/topology';
import {
  parseAnalyzerV1ModelResource,
  parseAnalyzerV1WorkloadResource,
} from '../contracts/analyzer/v1/overviewResources';
import {
  parseAnalyzerV1WorkerCostTree,
  parseAnalyzerV1WorkerOperationRange,
  parseAnalyzerV1WorkerOperationSeek,
} from '../contracts/analyzer/v1/workerOperation';
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
import type { WorkerCostTreeRef } from '../domain/workerOperation';
import type { AnalyzerRepository } from './AnalyzerRepository';
import {
  ArtifactModuleReaderError,
  resolveAnalyzerV1ArtifactPath,
} from './artifact/ArtifactModuleReader';
import type { ArtifactModuleReader } from './artifact/ArtifactModuleReader';

const DEFAULT_CATALOG_PATH = 'run_catalog.json';
const TOPOLOGY_PARAMS_HREF = 'raw/params.json';
const TOPOLOGY_RUN_META_HREF = 'raw/run_meta.json';

type NonReadySubjectArtifact = Exclude<SubjectArtifact, { status: 'ready' }>;

interface BoundArtifactRun {
  catalogEntry: AnalyzerV1RunCatalogEntry;
  descriptor: RunDescriptor;
  descriptorPath: string;
  runRoot: string;
}

export interface ArtifactAnalyzerRepositoryOptions {
  catalogPath?: string;
  /** Reserved for the first documented direct topology artifact schema. Static
   * analyzer-v1 exports without one use the explicit params+run_meta fallback. */
  topologyArtifactDecoder?: (input: unknown) => Topology;
}

export class UnknownAnalyzerRunError extends Error {
  constructor(readonly runId: string) {
    super(`Analyzer catalog has no run with opaque id ${runId}.`);
    this.name = 'UnknownAnalyzerRunError';
  }
}

export class ArtifactRunBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactRunBindingError';
  }
}

export class ArtifactDetailUnavailableError extends Error {
  constructor(
    readonly detailName: string,
    readonly status: DetailArtifact['status'] | SubjectStatus,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactDetailUnavailableError';
  }
}

function runRootOf(descriptorPath: string): string {
  const separator = descriptorPath.lastIndexOf('/');
  if (separator <= 0) {
    throw new ArtifactRunBindingError(
      `Run descriptor must live under a dedicated logical run directory: ${descriptorPath}`,
    );
  }
  return descriptorPath.slice(0, separator);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subjectTransportFailure<Name extends SubjectName>(
  subject: Name,
  error: unknown,
): SubjectResult<Name> {
  const code =
    error instanceof ArtifactModuleReaderError ? error.code : 'artifact_repository_failure';
  return {
    subject,
    status: 'failed',
    code,
    reason: errorDetail(error),
  } as SubjectResult<Name>;
}

function nonReadySubject<Name extends SubjectName>(
  subject: Name,
  artifact: NonReadySubjectArtifact,
): SubjectResult<Name> {
  return { subject, ...artifact } as SubjectResult<Name>;
}

/** Static analyzer export reader. Catalog and descriptor are the only discovery
 * authority; raw compatibility paths are fixed, bounded analyzer-v1 inputs and
 * every other resource must be declared by the selected descriptor. */
export class ArtifactAnalyzerRepository implements AnalyzerRepository {
  private readonly catalogPath: string;
  private catalogPromise: Promise<AnalyzerV1RunCatalog> | null = null;
  private readonly bindingPromises = new Map<string, Promise<BoundArtifactRun>>();

  constructor(
    private readonly reader: ArtifactModuleReader,
    private readonly options: ArtifactAnalyzerRepositoryOptions = {},
  ) {
    this.catalogPath = options.catalogPath ?? DEFAULT_CATALOG_PATH;
  }

  async listRuns(): Promise<readonly RunListItem[]> {
    const catalog = await this.loadCatalog();
    return catalog.runs.map((entry) => ({
      runId: entry.runId,
      kind: entry.kind,
      displayName: entry.displayName,
      lifecycle: entry.lifecycle,
    }));
  }

  async getRunDescriptor(runId: string): Promise<RunDescriptor> {
    return (await this.bindRun(runId)).descriptor;
  }

  async getRunSummary(runId: string) {
    const binding = await this.bindRun(runId);
    const input = await this.readRunArtifact(binding, binding.descriptor.summary.href);
    return parseAnalyzerV1RunSummary(input);
  }

  async getRunTopology(runId: string): Promise<Topology> {
    const binding = await this.bindRun(runId);
    const topologyRef = binding.descriptor.topology;
    if (topologyRef !== undefined) {
      if (this.options.topologyArtifactDecoder === undefined) {
        throw new ArtifactRunBindingError(
          `Run ${runId} declares a direct topology artifact, but analyzer-v1 has no configured topology artifact decoder.`,
        );
      }
      const input = await this.readRunArtifact(binding, topologyRef.href);
      return this.options.topologyArtifactDecoder(input);
    }

    const [params, runMeta] = await Promise.all([
      this.readRunArtifact(binding, TOPOLOGY_PARAMS_HREF),
      this.readRunArtifact(binding, TOPOLOGY_RUN_META_HREF),
    ]);
    return parseAnalyzerV1Topology(params, runMeta, binding.descriptor.deployment);
  }

  async getRunModel(runId: string) {
    const binding = await this.bindRun(runId);
    const model = binding.descriptor.model;
    if (model === undefined) {
      throw new ArtifactRunBindingError(`Run ${runId} does not declare a model resource.`);
    }
    return parseAnalyzerV1ModelResource(await this.readRunArtifact(binding, model.href));
  }

  async getRunWorkload(runId: string) {
    const binding = await this.bindRun(runId);
    const workload = binding.descriptor.workload;
    if (workload === undefined) {
      throw new ArtifactRunBindingError(`Run ${runId} does not declare a workload resource.`);
    }
    return parseAnalyzerV1WorkloadResource(await this.readRunArtifact(binding, workload.href));
  }

  async getSubject<Name extends SubjectName>(
    runId: string,
    subject: Name,
  ): Promise<SubjectResult<Name>> {
    let binding: BoundArtifactRun;
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
      const input = await this.readRunArtifact(binding, artifact.payload.href);
      const sourceRun = binding.descriptor.provenance;
      const expectedLogDir = sourceRun?.source === 'fixture' ? sourceRun.sourceRun : undefined;
      const decoded = decodeAnalyzerV1SubjectPayload(subject, input, { expectedLogDir });
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
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-operation-index', binding.descriptor);
    const path = `workers/${worker.poolTag}/${worker.workerId}/operations?offset=${page.offset}&limit=${page.limit}`;
    return parseAnalyzerV1WorkerOperationRange(await this.readRunArtifact(binding, path), worker);
  }

  async getWorkerOperationSeek(runId: string, worker: WorkerRef, atMs: number, limit: number) {
    if (!Number.isFinite(atMs) || atMs < 0) {
      throw new ArtifactRunBindingError(
        'Worker operation seek time must be finite and non-negative.',
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 384) {
      throw new ArtifactRunBindingError(
        'Worker operation seek limit must be an integer from 1 to 384.',
      );
    }
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-operation-index', binding.descriptor);
    const path = `workers/${worker.poolTag}/${worker.workerId}/operations/seek?at_ms=${encodeURIComponent(String(atMs))}`;
    return parseAnalyzerV1WorkerOperationSeek(
      await this.readRunArtifact(binding, path),
      worker,
      atMs,
      limit,
    );
  }

  async getWorkerCostTree(runId: string, ref: WorkerCostTreeRef) {
    const binding = await this.bindRun(runId);
    this.requireReadyDetail(runId, 'worker-cost-tree', binding.descriptor);
    const path = `workers/${ref.worker.poolTag}/${ref.worker.workerId}/operations/${ref.iterId}/${ref.batchId}/${ref.operationId}/cost-tree`;
    return parseAnalyzerV1WorkerCostTree(await this.readRunArtifact(binding, path), ref);
  }

  async getTrace(runId: string, traceName: string): Promise<TraceResource> {
    let binding: BoundArtifactRun;
    try {
      binding = await this.bindRun(runId);
    } catch (error) {
      return { status: 'failed', code: 'artifact_repository_failure', reason: errorDetail(error) };
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
      const address = await this.readRunArtifact(binding, trace.artifact.href);
      if (typeof address !== 'string' || address.length === 0) {
        return {
          status: 'failed',
          code: 'trace_address_invalid',
          reason: `Trace module ${trace.artifact.href} did not resolve to a browser URL.`,
        };
      }
      return { status: 'ready', artifact: { ...trace.artifact, href: address } };
    } catch (error) {
      return {
        status: 'failed',
        code: error instanceof ArtifactModuleReaderError ? error.code : 'trace_load_failed',
        reason: errorDetail(error),
      };
    }
  }

  private loadCatalog() {
    if (this.catalogPromise !== null) return this.catalogPromise;
    const promise = this.reader
      .read(this.catalogPath)
      .then(parseAnalyzerV1RunCatalog)
      .catch((error: unknown) => {
        if (this.catalogPromise === promise) this.catalogPromise = null;
        throw error;
      });
    this.catalogPromise = promise;
    return promise;
  }

  private bindRun(runId: string): Promise<BoundArtifactRun> {
    const cached = this.bindingPromises.get(runId);
    if (cached !== undefined) return cached;
    const promise = this.loadCatalog()
      .then(async (catalog) => {
        const catalogEntry = catalog.runs.find((entry) => entry.runId === runId);
        if (catalogEntry === undefined) throw new UnknownAnalyzerRunError(runId);
        const descriptorPath = resolveAnalyzerV1ArtifactPath({
          containingArtifactPath: this.catalogPath,
          artifactHref: catalogEntry.descriptorHref,
        });
        const descriptor = parseAnalyzerV1RunDescriptor(await this.reader.read(descriptorPath));
        if (descriptor.runId !== runId) {
          throw new ArtifactRunBindingError(
            `Descriptor run id ${descriptor.runId} does not match requested opaque id ${runId}.`,
          );
        }
        return {
          catalogEntry,
          descriptor,
          descriptorPath,
          runRoot: runRootOf(descriptorPath),
        };
      })
      .catch((error: unknown) => {
        if (this.bindingPromises.get(runId) === promise) this.bindingPromises.delete(runId);
        throw error;
      });
    this.bindingPromises.set(runId, promise);
    return promise;
  }

  private readRunArtifact(binding: BoundArtifactRun, artifactHref: string): Promise<unknown> {
    return this.reader.readRelative({
      containingArtifactPath: binding.descriptorPath,
      artifactHref,
      runRoot: binding.runRoot,
    });
  }

  private detailUnavailable(
    runId: string,
    detailName: string,
    descriptor: RunDescriptor,
  ): ArtifactDetailUnavailableError {
    const detail = descriptor.details[detailName];
    if (detail === undefined) {
      return new ArtifactDetailUnavailableError(
        detailName,
        'not_generated',
        `Run ${runId} does not declare detail resource ${detailName}.`,
      );
    }
    if (detail.status === 'ready') {
      return new ArtifactDetailUnavailableError(
        detailName,
        'incompatible',
        `Run ${runId} declares ${detailName} ready, but this UI has no protocol-v1 detail decoder.`,
      );
    }
    const reason = 'reason' in detail && detail.reason ? `: ${detail.reason}` : '';
    return new ArtifactDetailUnavailableError(
      detailName,
      detail.status,
      `Run ${runId} detail ${detailName} is ${detail.status}${reason}`,
    );
  }

  private requireReadyDetail(runId: string, detailName: string, descriptor: RunDescriptor): void {
    const detail = descriptor.details[detailName];
    if (detail?.status !== 'ready') throw this.detailUnavailable(runId, detailName, descriptor);
    if (detail.resource.href !== 'workers') {
      throw new ArtifactDetailUnavailableError(
        detailName,
        'incompatible',
        `Run ${runId} detail ${detailName} must declare resource href base workers.`,
      );
    }
  }
}
