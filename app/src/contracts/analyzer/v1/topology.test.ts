import { describe, expect, it } from 'vitest';

import paramsJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/params.json';
import runMetaJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
import { makeWorkerKey } from '../../../domain/worker';
import { parseAnalyzerV1Topology } from './topology';

function group(type: string, workerType: string): Record<string, unknown> {
  return {
    gpu: 'NVIDIA H200',
    replicas: 1,
    arch: {
      type,
      model_config: 'model/config/llama3_8b.json',
      tp_size: 1,
      fp8: false,
    },
    worker: { type: workerType, attn_gpu_memory_gb: 80, max_batch_tokens: 4096 },
  };
}

function pool(rawGroup: Record<string, unknown>): Record<string, unknown> {
  return { placement: 'least-queued', groups: [rawGroup] };
}

function twoPoolMeta(schemaVersion: 1 | 2): Record<string, unknown> {
  const base: Record<string, unknown> = {
    schema_version: schemaVersion,
    num_gpus: 2,
    gpus: [
      { id: 0, name: 'NVIDIA H200', pool: 0, worker_id: 0 },
      { id: 1, name: 'NVIDIA H200', pool: 1, worker_id: 0 },
    ],
    workers: [
      { worker_id: 0, pool: 0, gpu_ids: [0] },
      { worker_id: 0, pool: 1, gpu_ids: [1] },
    ],
  };
  if (schemaVersion === 2) {
    base.comm_groups = [
      {
        gid: 0,
        base: 0,
        count: 1,
        gpu_ids: [0],
        owner_pool: 'prefill',
        owner_worker_id: 0,
      },
      {
        gid: 1,
        base: 1,
        count: 1,
        gpu_ids: [1],
        owner_pool: 'decode',
        owner_worker_id: 0,
      },
    ];
  }
  return base;
}

describe('parseAnalyzerV1Topology', () => {
  it('adapts the real 20260715 AFD topology with composite worker identity', () => {
    const topology = parseAnalyzerV1Topology(paramsJson, runMetaJson);

    expect(topology.pools.map((pool) => pool.role)).toEqual(['attn', 'ffn']);
    expect(topology.pools[0].groups[0]).toMatchObject({
      gpu: 'NVIDIA H200',
      replicas: 8,
      gpusPerReplica: 4,
      numGpus: 32,
      arch: {
        type: 'qwen3_attn_tp',
        model: 'model/config/qwen3_coder_480b.json',
        params: { attn_tp: 4, fp8: 'true' },
      },
      worker: { type: 'disagg_attn', memGb: 144 },
    });
    expect(topology.pools[1].groups[0]).toMatchObject({
      replicas: 2,
      gpusPerReplica: 8,
      numGpus: 16,
      arch: { params: { attn_tp: 4, ep: 8, nvl: 8, routing: 'uniform' } },
    });
    const workerKeys = topology.pools.flatMap((pool) =>
      pool.groups.flatMap((group) =>
        group.workers.map((worker) => makeWorkerKey(pool.role, worker.id)),
      ),
    );
    expect(workerKeys).toContain(makeWorkerKey('attn', 0));
    expect(workerKeys).toContain(makeWorkerKey('ffn', 0));
    expect(new Set(workerKeys)).toHaveProperty('size', 10);
  });

  it('adapts the confirmed unified v1 role and GPU ownership', () => {
    const params = {
      deployment: 'unified',
      pools: { main: pool(group('llama3_dense_tp', 'barebone')) },
    };
    const meta = {
      schema_version: 1,
      num_gpus: 1,
      gpus: [{ id: 0, name: 'NVIDIA H200', pool: 0, worker_id: 0 }],
      workers: [{ worker_id: 0, pool: 0, gpu_ids: [0] }],
    };

    expect(parseAnalyzerV1Topology(params, meta).pools[0]).toMatchObject({
      role: 'main',
      groups: [
        {
          replicas: 1,
          gpusPerReplica: 1,
          worker: { maxBatchTokens: 4096 },
          workers: [{ id: '0', gpus: [0] }],
        },
      ],
    });
  });

  it('adapts PD v2 comm ownership while preserving duplicate worker ids across pools', () => {
    const params = {
      deployment: 'pd',
      pools: {
        prefill: pool(group('llama3_dense_tp', 'pd_prefill')),
        decode: pool(group('llama3_dense_tp', 'pd_decode')),
      },
    };
    const topology = parseAnalyzerV1Topology(params, twoPoolMeta(2));

    expect(topology.pools.map((entry) => [entry.role, entry.groups[0].workers[0].id])).toEqual([
      ['prefill', '0'],
      ['decode', '0'],
    ]);
  });

  it('rejects contradictory comm-group ownership instead of guessing a pool', () => {
    const params = {
      deployment: 'pd',
      pools: {
        prefill: pool(group('llama3_dense_tp', 'pd_prefill')),
        decode: pool(group('llama3_dense_tp', 'pd_decode')),
      },
    };
    const meta = twoPoolMeta(2);
    const commGroups = meta.comm_groups as Array<{ owner_pool: string }>;
    commGroups[1].owner_pool = 'prefill';

    expect(() => parseAnalyzerV1Topology(params, meta)).toThrow(
      /owner_pool: prefill disagrees with deployment pool decode/,
    );
  });

  it('rejects multiple groups because run_meta has no group identity', () => {
    const params = structuredClone(paramsJson);
    params.pools.attn.groups.push(structuredClone(params.pools.attn.groups[0]));

    expect(() => parseAnalyzerV1Topology(params, runMetaJson)).toThrow(
      /run_meta cannot identify 2 groups/,
    );
  });

  it('rejects a descriptor deployment that disagrees with params', () => {
    expect(() => parseAnalyzerV1Topology(paramsJson, runMetaJson, 'pd')).toThrow(
      /params\.deployment: afd disagrees with descriptor pd/,
    );
  });
});
