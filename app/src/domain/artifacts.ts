import type { SubjectName } from './subject';
import type { WorkerRef } from './worker';
import type { Deployment } from './deployment';

export type RunKind = 'simulation';
export type LifecycleStageStatus = 'not_started' | 'pending' | 'complete' | 'failed';

export interface RunLifecycle {
  simulation: LifecycleStageStatus;
  analysis: LifecycleStageStatus;
}

/** Artifact-faithful root summary fields. Latency percentiles remain owned by
 * the independently queried SLO subject. */
export interface RunSummaryArtifact {
  totalTokS: number;
  numGpus: number;
  requestsFinished: number;
  requestsTotal?: number;
}

/** A bounded artifact address. Repositories, not components, resolve `href`. */
export interface ArtifactRef {
  href: string;
  mediaType?: string;
  schemaVersion?: number;
  byteLength?: number;
  sha256?: string;
}

/** Storage provenance and data origin are separate: a checked-in fixture may
 * be a bounded copy of real analyzer output (`synthetic: false`). */
export type ArtifactProvenance =
  | {
      source: 'analyzer';
      synthetic: false;
      generatedAt?: string;
      generatorVersion?: string;
    }
  | {
      source: 'fixture';
      synthetic: boolean;
      fixtureId: string;
      sourceRun?: string;
      generatedAt?: string;
    };

export type PendingArtifact = {
  status: 'pending';
  reason?: string;
};

export type UnavailableArtifact = {
  status: 'unavailable';
  reason: string;
  code?: string;
};

export type NotGeneratedArtifact = {
  status: 'not_generated';
  reason?: string;
};

export type FailedArtifact = {
  status: 'failed';
  code: string;
  reason: string;
};

type ReadySubjectArtifactBase = {
  status: 'ready';
  schemaVersion: number;
};

/** A ready subject must expose at least its report or its plot payload. */
export type ReadySubjectArtifact = ReadySubjectArtifactBase &
  ({ report: ArtifactRef; payload?: ArtifactRef } | { report?: ArtifactRef; payload: ArtifactRef });

export type SubjectArtifact =
  | ReadySubjectArtifact
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;

export type DetailArtifact =
  | { status: 'ready'; schemaVersion: number; resource: ArtifactRef }
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;

export type TraceResource =
  | { status: 'ready'; artifact: ArtifactRef }
  | PendingArtifact
  | UnavailableArtifact
  | NotGeneratedArtifact
  | FailedArtifact;

export interface RunListItem {
  runId: string;
  kind: RunKind;
  displayName?: string;
  modelName?: string;
  deployment?: Deployment;
  lifecycle: RunLifecycle;
  provenance?: ArtifactProvenance;
}

/**
 * Discovery metadata only. High-cardinality timelines and iteration details
 * belong behind repository methods and must not be embedded in this descriptor.
 */
export interface RunDescriptor extends RunListItem {
  protocolVersion: 1;
  /** Required for a full descriptor even though catalog rows may omit it. */
  deployment: Deployment;
  summary: ArtifactRef;
  model?: ArtifactRef;
  topology?: ArtifactRef;
  workers?: readonly WorkerRef[];
  subjects: Partial<Record<SubjectName, SubjectArtifact>>;
  details: Readonly<Record<string, DetailArtifact>>;
  traces: Readonly<Record<string, TraceResource>>;
  analysis?: {
    revision: string;
    generatedAt: string;
    generatorVersion: string;
  };
}
