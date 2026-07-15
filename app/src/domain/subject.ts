import type { KernelThroughput } from './kernelThroughput';
import type { KernelTimeShare } from './kernelTimeShare';
import type {
  BatchSubject,
  Concurrency,
  Conservation,
  KvSeries,
  PendingQueue,
  Slo,
  Throughput,
  UtilSeries,
} from './run';

/**
 * Analyzer subjects known by the UI domain.
 *
 * Payloads intentionally remain `unknown` until each analyzer-v1 adapter owns
 * a subject-specific runtime schema. Do not weaken `SubjectResult`: consumers
 * must still handle every loading/availability outcome explicitly.
 */
export const SUBJECT_NAMES = [
  'slo',
  'throughput',
  'utilization',
  'kv',
  'concurrency',
  'backpressure',
  'batch',
  'kernelThroughput',
  'conservation',
  'kernelInputDistribution',
  'kernelTimeShare',
] as const;

export type SubjectName = (typeof SUBJECT_NAMES)[number];

export interface SubjectPayloadByName {
  slo: Slo;
  throughput: Throughput;
  utilization: UtilSeries;
  kv: KvSeries;
  concurrency: Concurrency;
  backpressure: PendingQueue;
  batch: BatchSubject;
  kernelThroughput: KernelThroughput;
  conservation: Conservation;
  kernelInputDistribution: unknown;
  kernelTimeShare: KernelTimeShare;
}

/** `incompatible` is produced by the UI adapter, never by analyzer itself. */
export type SubjectStatus =
  'pending' | 'ready' | 'unavailable' | 'not_generated' | 'failed' | 'incompatible';

interface SubjectResultBase<Name extends SubjectName> {
  subject: Name;
}

export type SubjectResult<Name extends SubjectName = SubjectName> =
  | (SubjectResultBase<Name> & {
      status: 'ready';
      schemaVersion: number;
      payload: SubjectPayloadByName[Name];
    })
  | (SubjectResultBase<Name> & {
      status: 'pending';
      reason?: string;
    })
  | (SubjectResultBase<Name> & {
      status: 'unavailable';
      reason: string;
      code?: string;
    })
  | (SubjectResultBase<Name> & {
      status: 'not_generated';
      reason?: string;
    })
  | (SubjectResultBase<Name> & {
      status: 'failed';
      code: string;
      reason: string;
    })
  | (SubjectResultBase<Name> & {
      status: 'incompatible';
      reason: string;
      receivedSchemaVersion?: number;
    });
