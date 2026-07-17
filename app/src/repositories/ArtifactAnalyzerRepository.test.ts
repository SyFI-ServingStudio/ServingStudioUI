import { describe, expect, it, vi } from 'vitest';

import catalogJson from '../../../fixtures/analyzer-v1/run_catalog.json';
import descriptorJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/run_descriptor.json';
import paramsJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMetaJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import summaryJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/summary.json';
import batchJson from '../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/payloads/batch_scatter.json';
import type { Topology } from '../domain/run';
import { makeWorkerRef } from '../domain/worker';
import {
  ArtifactAnalyzerRepository,
  ArtifactDetailUnavailableError,
  UnknownAnalyzerRunError,
} from './ArtifactAnalyzerRepository';
import {
  ArtifactModuleReader,
  type ArtifactModuleLoader,
  type ArtifactModuleMap,
} from './artifact/ArtifactModuleReader';
import { bundledArtifactAnalyzerRepository } from './artifact/bundledAnalyzerArtifacts';

const RUN_ID = 'fixture-afd-qwen3-v1';
const RUN_ROOT = 'afd-qwen3-duration-reached';
const DESCRIPTOR_PATH = `${RUN_ROOT}/run_descriptor.json`;

function loader(value: unknown): ArtifactModuleLoader {
  return async () => value;
}

function repositoryWith(modules: ArtifactModuleMap): ArtifactAnalyzerRepository {
  return new ArtifactAnalyzerRepository(new ArtifactModuleReader(modules));
}

function coreModules(descriptor: unknown = descriptorJson): Record<string, ArtifactModuleLoader> {
  return {
    'run_catalog.json': loader(catalogJson),
    [DESCRIPTOR_PATH]: loader(descriptor),
    [`${RUN_ROOT}/summary.json`]: loader(summaryJson),
    [`${RUN_ROOT}/raw/params.json`]: loader(paramsJson),
    [`${RUN_ROOT}/raw/run_meta.json`]: loader(runMetaJson),
  };
}

describe('ArtifactAnalyzerRepository', () => {
  it('loads only the catalog during discovery and preserves its opaque identity', async () => {
    const catalogLoader = vi.fn(async () => catalogJson);
    const descriptorLoader = vi.fn(async () => descriptorJson);
    const repository = repositoryWith({
      'run_catalog.json': catalogLoader,
      [DESCRIPTOR_PATH]: descriptorLoader,
    });

    await expect(repository.listRuns()).resolves.toEqual([
      {
        runId: RUN_ID,
        kind: 'simulation',
        displayName: '20260715_1_afd_ui_reanalysis',
        lifecycle: { simulation: 'complete', analysis: 'complete' },
      },
    ]);
    expect(catalogLoader).toHaveBeenCalledTimes(1);
    expect(descriptorLoader).not.toHaveBeenCalled();
  });

  it('binds the requested catalog id to the exact descriptor id and revision', async () => {
    const repository = repositoryWith(coreModules());

    const descriptor = await repository.getRunDescriptor(RUN_ID);

    expect(descriptor.runId).toBe(RUN_ID);
    expect(descriptor.analysis?.revision).toBe(descriptorJson.analysis.revision);
    expect(descriptor.analysis?.revision).toMatch(/^fixture-sha256-[a-f0-9]{64}$/);
    await expect(repository.getRunDescriptor('path-like-name')).rejects.toBeInstanceOf(
      UnknownAnalyzerRunError,
    );
  });

  it('rejects a descriptor whose identity differs from the requested opaque id', async () => {
    const descriptor = structuredClone(descriptorJson);
    descriptor.run_id = 'a-different-id';
    const repository = repositoryWith(coreModules(descriptor));

    await expect(repository.getRunDescriptor(RUN_ID)).rejects.toThrow(
      /does not match requested opaque id/,
    );
  });

  it('decodes bounded core artifacts and the explicit topology fallback', async () => {
    const repository = repositoryWith(coreModules());

    const [summary, topology] = await Promise.all([
      repository.getRunSummary(RUN_ID),
      repository.getRunTopology(RUN_ID),
    ]);

    expect(summary).toMatchObject({ numGpus: 48, requestsFinished: 5587 });
    expect(topology.pools.map((pool) => pool.role)).toEqual(['attn', 'ffn']);
    expect(topology.pools.flatMap((pool) => pool.groups[0].workers)).toHaveLength(10);
  });

  it('decodes descriptor-declared model and workload resources', async () => {
    const descriptor = structuredClone(descriptorJson) as Record<string, unknown>;
    descriptor.model = { href: 'artifacts/model.json', schema_version: 1 };
    descriptor.workload = { href: 'artifacts/workload.json', schema_version: 1 };
    const modules = coreModules(descriptor);
    modules[`${RUN_ROOT}/artifacts/model.json`] = loader({
      schema_version: 1,
      source_path: 'model/config/qwen3_coder_480b.json',
      config: { hidden_size: 6144 },
    });
    modules[`${RUN_ROOT}/artifacts/workload.json`] = loader({
      schema_version: 1,
      scope: 'configured_trace',
      source_paths: ['trace/aime_long.csv'],
      request_count: 2,
      average_input_tokens: 24,
      average_output_tokens: 32,
      arrival_basis: 'source_trace',
      request_rate: 0,
      token_lengths: [16],
      input_density: [1],
      output_density: [1],
      arrival_seconds: [0],
      arrivals: [2],
      arrival_trend: [2],
      peak_to_mean: 1,
    });
    const repository = repositoryWith(modules);

    await expect(repository.getRunModel(RUN_ID)).resolves.toMatchObject({
      config: { hidden_size: 6144 },
    });
    await expect(repository.getRunWorkload(RUN_ID)).resolves.toMatchObject({
      requestCount: 2,
      arrivalBasis: 'source_trace',
    });
  });

  it('prefers a declared direct topology and never loads compatibility inputs', async () => {
    const descriptor = structuredClone(descriptorJson) as Record<string, unknown>;
    descriptor.topology = { href: 'artifacts/topology.json', schema_version: 1 };
    const directTopology: Topology = { pools: [] };
    const paramsLoader = vi.fn(async () => paramsJson);
    const runMetaLoader = vi.fn(async () => runMetaJson);
    const directLoader = vi.fn(async () => ({ direct: true }));
    const modules = coreModules(descriptor);
    modules[`${RUN_ROOT}/raw/params.json`] = paramsLoader;
    modules[`${RUN_ROOT}/raw/run_meta.json`] = runMetaLoader;
    modules[`${RUN_ROOT}/artifacts/topology.json`] = directLoader;
    const repository = new ArtifactAnalyzerRepository(new ArtifactModuleReader(modules), {
      topologyArtifactDecoder: () => directTopology,
    });

    await expect(repository.getRunTopology(RUN_ID)).resolves.toBe(directTopology);
    expect(directLoader).toHaveBeenCalledTimes(1);
    expect(paramsLoader).not.toHaveBeenCalled();
    expect(runMetaLoader).not.toHaveBeenCalled();
  });

  it('contains missing and corrupt optional subject artifacts locally', async () => {
    const missingRepository = repositoryWith(coreModules());
    await expect(missingRepository.getSubject(RUN_ID, 'batch')).resolves.toMatchObject({
      subject: 'batch',
      status: 'failed',
      code: 'artifact_missing',
    });

    const corruptModules = coreModules();
    corruptModules[`${RUN_ROOT}/payloads/batch_scatter.json`] = loader({ malformed: true });
    const corruptRepository = repositoryWith(corruptModules);
    await expect(corruptRepository.getSubject(RUN_ID, 'batch')).resolves.toMatchObject({
      subject: 'batch',
      status: 'incompatible',
      reason: expect.stringContaining('Invalid analyzer-v1 batch payload'),
    });
  });

  it('does not read a payload for a descriptor-declared unavailable subject', async () => {
    const unexpectedLoader = vi.fn(async () => ({ shouldNotLoad: true }));
    const modules = coreModules();
    modules[`${RUN_ROOT}/payloads/kernel_input_distribution_scatter.json`] = unexpectedLoader;
    const repository = repositoryWith(modules);

    await expect(repository.getSubject(RUN_ID, 'kernelInputDistribution')).resolves.toMatchObject({
      subject: 'kernelInputDistribution',
      status: 'unavailable',
      code: 'missing_kernel_input_columns',
    });
    expect(unexpectedLoader).not.toHaveBeenCalled();
  });

  it('rejects descriptor/payload schema-version disagreement locally', async () => {
    const descriptor = structuredClone(descriptorJson);
    descriptor.subjects.batch.schema_version = 2;
    const modules = coreModules(descriptor);
    modules[`${RUN_ROOT}/payloads/batch_scatter.json`] = loader(batchJson);
    const repository = repositoryWith(modules);

    await expect(repository.getSubject(RUN_ID, 'batch')).resolves.toMatchObject({
      subject: 'batch',
      status: 'incompatible',
      receivedSchemaVersion: 1,
      reason: expect.stringContaining('declares batch schema v2'),
    });
  });

  it('returns descriptor trace state and refuses to synthesize worker executions', async () => {
    const repository = repositoryWith(coreModules());

    await expect(repository.getTrace(RUN_ID, 'perfetto')).resolves.toMatchObject({
      status: 'not_generated',
    });
    await expect(
      repository.getWorkerOperations(RUN_ID, makeWorkerRef('attn', 0), {
        offset: 0,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ArtifactDetailUnavailableError);
  });
});

describe('bundled analyzer-v1 artifact export', () => {
  it('loads the real catalog, core and aggregate subjects without claiming worker detail', async () => {
    const [runs, descriptor, summary, topology] = await Promise.all([
      bundledArtifactAnalyzerRepository.listRuns(),
      bundledArtifactAnalyzerRepository.getRunDescriptor(RUN_ID),
      bundledArtifactAnalyzerRepository.getRunSummary(RUN_ID),
      bundledArtifactAnalyzerRepository.getRunTopology(RUN_ID),
    ]);

    expect(runs[0]).toMatchObject({ runId: RUN_ID, displayName: descriptor.displayName });
    expect(summary.numGpus).toBe(48);
    expect(topology.pools.flatMap((pool) => pool.groups[0].workers)).toHaveLength(10);

    const readySubjects = [
      'slo',
      'throughput',
      'utilization',
      'kv',
      'batch',
      'kernelThroughput',
      'conservation',
      'kernelTimeShare',
    ] as const;
    const subjectResults = await Promise.all(
      readySubjects.map((subject) => bundledArtifactAnalyzerRepository.getSubject(RUN_ID, subject)),
    );
    expect(subjectResults.every((result) => result.status === 'ready')).toBe(true);
    await expect(
      bundledArtifactAnalyzerRepository.getSubject(RUN_ID, 'backpressure'),
    ).resolves.toMatchObject({ status: 'not_generated' });
    await expect(
      bundledArtifactAnalyzerRepository.getSubject(RUN_ID, 'kernelInputDistribution'),
    ).resolves.toMatchObject({ status: 'unavailable' });

    await expect(
      bundledArtifactAnalyzerRepository.getWorkerCostTree(RUN_ID, {
        worker: makeWorkerRef('attn', 0),
        iterId: '0',
        batchId: '0',
        operationId: '0',
      }),
    ).rejects.toMatchObject({
      detailName: 'worker-cost-tree',
      status: 'not_generated',
    });
  });
});
