import type {
  RunDescriptor,
  RunSummaryArtifact,
  SubjectArtifact,
  TraceResource,
} from '../domain/artifacts';
import type { KvSeries, Slo, Throughput, Topology, UtilSeries } from '../domain/run';
import type { SubjectName, SubjectResult } from '../domain/subject';
import { makeWorkerKey, makeWorkerRef, type WorkerKey, type WorkerRef } from '../domain/worker';
import { annotate, leaf, type CostNode } from '../data/tree';
import type { AnalyzerRepository } from '../repositories/AnalyzerRepository';
import type { SubjectResults } from '../application/loadActiveRun';

export interface RepositoryCallCounts {
  list: number;
  descriptor: number;
  summary: number;
  topology: number;
  subjects: number;
  trees: number;
}

export const TEST_WORKERS = [makeWorkerRef('attn', 0), makeWorkerRef('ffn', 0)] as const;

const readyArtifact = (subject: string): SubjectArtifact => ({
  status: 'ready',
  schemaVersion: 1,
  payload: { href: `fixture://test/payloads/${subject}.json` },
});

export function makeTestDescriptor(overrides: Partial<RunDescriptor> = {}): RunDescriptor {
  return {
    protocolVersion: 1,
    runId: 'test-run',
    kind: 'simulation',
    displayName: 'Test run',
    modelName: 'model/test.json',
    deployment: 'afd',
    lifecycle: { simulation: 'complete', analysis: 'complete' },
    summary: { href: 'fixture://test/summary.json' },
    topology: { href: 'fixture://test/topology.json' },
    workers: [...TEST_WORKERS],
    subjects: {
      slo: readyArtifact('slo'),
      throughput: readyArtifact('throughput'),
      utilization: readyArtifact('utilization'),
      kv: readyArtifact('kv'),
      concurrency: { status: 'not_generated', reason: 'Not logged.' },
      backpressure: { status: 'not_generated', reason: 'Not logged.' },
      batch: { status: 'not_generated', reason: 'Not logged.' },
      conservation: { status: 'not_generated', reason: 'Not logged.' },
      kernelInputDistribution: { status: 'not_generated', reason: 'Not logged.' },
      kernelTimeShare: { status: 'not_generated', reason: 'Not logged.' },
    },
    traces: {
      perfetto: { status: 'not_generated', reason: 'Not requested.' },
    },
    provenance: {
      source: 'fixture',
      synthetic: false,
      fixtureId: 'test-run',
      sourceRun: 'test-run',
    },
    ...overrides,
  };
}

export function makeTestTopology(): Topology {
  return {
    pools: [
      {
        role: 'attn',
        placement: 'packed',
        groups: [
          {
            gpu: 'NVIDIA H200',
            replicas: 1,
            gpusPerReplica: 1,
            numGpus: 1,
            arch: { type: 'test_attn', model: 'model/test.json', params: { tp: 1 } },
            worker: { type: 'test_attn_worker' },
            workers: [{ id: '0', gpus: [0] }],
          },
        ],
      },
      {
        role: 'ffn',
        placement: 'packed',
        groups: [
          {
            gpu: 'NVIDIA H200',
            replicas: 1,
            gpusPerReplica: 1,
            numGpus: 1,
            arch: { type: 'test_ffn', model: 'model/test.json', params: { tp: 1 } },
            worker: { type: 'test_ffn_worker' },
            workers: [{ id: '0', gpus: [1] }],
          },
        ],
      },
    ],
  };
}

function metric(label: string): Slo['ttft'] {
  return {
    label,
    unit: 'ms',
    x: [1, 2],
    y_pct: [50, 100],
    markers: { p50: 1, p90: 2, p99: 3 },
  };
}

export function makeTestSubjectResults(): SubjectResults {
  const slo: Slo = { ttft: metric('TTFT'), tpot: metric('TPOT'), e2e: metric('E2E') };
  const throughput: Throughput = {
    t_start_ms: [0],
    t_end_ms: [1],
    total: [10],
    prefill: [4],
    decode: [6],
  };
  const utilization: UtilSeries = {
    t_ms: [0],
    series: [{ key: 'attn/0', label: 'attn/0', poolTag: 'attn', util: [0.5] }],
  };
  const kv: KvSeries = {
    t_ms: [0],
    series: [{ label: 'attn/0', poolTag: 'attn', capacity: 100, active: [20] }],
  };
  const missing = <Name extends SubjectName>(subject: Name): SubjectResult<Name> => ({
    subject,
    status: 'not_generated',
    reason: 'Not logged.',
  });

  return {
    slo: { subject: 'slo', status: 'ready', schemaVersion: 1, payload: slo },
    throughput: { subject: 'throughput', status: 'ready', schemaVersion: 1, payload: throughput },
    utilization: {
      subject: 'utilization',
      status: 'ready',
      schemaVersion: 1,
      payload: utilization,
    },
    kv: { subject: 'kv', status: 'ready', schemaVersion: 1, payload: kv },
    concurrency: missing('concurrency'),
    backpressure: missing('backpressure'),
    batch: missing('batch'),
    conservation: missing('conservation'),
    kernelInputDistribution: missing('kernelInputDistribution'),
    kernelTimeShare: missing('kernelTimeShare'),
  };
}

function makeTrees(workers: readonly WorkerRef[]): Record<WorkerKey, CostNode> {
  return Object.fromEntries(
    workers.map((worker) => [
      makeWorkerKey(worker),
      annotate(leaf(`${worker.poolTag}.kernel`, 'single_gemm', '{}', 1)),
    ]),
  ) as Record<WorkerKey, CostNode>;
}

export function createTestRepository(
  options: {
    descriptor?: RunDescriptor;
    summary?: RunSummaryArtifact;
    topology?: Topology;
    subjects?: SubjectResults;
    trees?: Record<WorkerKey, CostNode>;
  } = {},
): { repository: AnalyzerRepository; calls: RepositoryCallCounts } {
  const descriptor = options.descriptor ?? makeTestDescriptor();
  const summary = options.summary ?? { totalTokS: 10, numGpus: 2, requestsFinished: 5 };
  const topology = options.topology ?? makeTestTopology();
  const subjects = options.subjects ?? makeTestSubjectResults();
  const trees = options.trees ?? makeTrees(TEST_WORKERS);
  const calls: RepositoryCallCounts = {
    list: 0,
    descriptor: 0,
    summary: 0,
    topology: 0,
    subjects: 0,
    trees: 0,
  };

  const repository: AnalyzerRepository = {
    async listRuns() {
      calls.list += 1;
      return [
        {
          runId: descriptor.runId,
          kind: descriptor.kind,
          displayName: descriptor.displayName,
          modelName: descriptor.modelName,
          deployment: descriptor.deployment,
          lifecycle: descriptor.lifecycle,
          provenance: descriptor.provenance,
        },
      ];
    },
    async getRunDescriptor() {
      calls.descriptor += 1;
      return descriptor;
    },
    async getRunSummary() {
      calls.summary += 1;
      return summary;
    },
    async getRunTopology() {
      calls.topology += 1;
      return topology;
    },
    async getSubject<Name extends SubjectName>(
      _runId: string,
      subject: Name,
    ): Promise<SubjectResult<Name>> {
      calls.subjects += 1;
      return subjects[subject];
    },
    async getWorkerCostTree(_runId: string, worker: WorkerRef) {
      calls.trees += 1;
      const tree = trees[makeWorkerKey(worker)];
      if (!tree) throw new Error(`Missing test tree for ${makeWorkerKey(worker)}.`);
      return tree;
    },
    async getWorkerTimeline() {
      throw new Error('Worker timelines are outside this test fixture.');
    },
    async getIteration() {
      throw new Error('Iterations are outside this test fixture.');
    },
    async getTrace(_runId: string, traceName: string): Promise<TraceResource> {
      return descriptor.traces[traceName] ?? { status: 'not_generated', reason: 'Not requested.' };
    },
  };

  return { repository, calls };
}
