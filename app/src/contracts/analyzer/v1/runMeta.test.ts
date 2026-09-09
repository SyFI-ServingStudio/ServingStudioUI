import { describe, expect, it } from 'vitest';

import { parseAnalyzerV1RunMeta } from './runMeta';

function minimalV1(): Record<string, unknown> {
  return {
    schema_version: 1,
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
}

describe('parseAnalyzerV1RunMeta', () => {
  it('rejects a v4 worker whose authoritative pool_tag is null', () => {
    const meta = {
      schema_version: 4,
      num_gpus: 1,
      gpus: [{ id: 0, name: 'NVIDIA H200', pool: 0, worker_id: 0, pool_tag: 'ffn' }],
      workers: [{ worker_id: 0, pool: 0, pool_tag: null, gpu_ids: [0], kv_pools: [] }],
      comm_groups: [],
    };

    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/pool_tag/);
  });

  it('accepts v5 as an append-only v4 roster with an open stage vocabulary', () => {
    const meta = {
      schema_version: 5,
      num_gpus: 1,
      gpus: [{ id: 0, name: 'NVIDIA H200', pool: 0, worker_id: 0, pool_tag: 'main' }],
      workers: [{ worker_id: 0, pool: 0, pool_tag: 'main', gpu_ids: [0], kv_pools: [] }],
      comm_groups: [],
      stage_vocab: {
        deployment: 'unified',
        names: ['pending:prefill', 'suspended:preempted', 'done:request'],
      },
    };

    const parsed = parseAnalyzerV1RunMeta(meta);
    expect(parsed.schema_version).toBe(5);
    if (parsed.schema_version !== 5) throw new Error('expected v5 run metadata');
    expect(parsed.stage_vocab.names).toContain('suspended:preempted');
  });

  it('rejects malformed or duplicate v5 stage names', () => {
    const meta = {
      schema_version: 5,
      num_gpus: 1,
      gpus: [{ id: 0, name: 'NVIDIA H200', pool: 0, worker_id: 0, pool_tag: 'main' }],
      workers: [{ worker_id: 0, pool: 0, pool_tag: 'main', gpu_ids: [0], kv_pools: [] }],
      comm_groups: [],
      stage_vocab: {
        deployment: 'unified',
        names: ['pending:request', 'done:request'],
      },
    };

    expect(() => parseAnalyzerV1RunMeta(meta)).not.toThrow();
    meta.stage_vocab.names = ['pending', 'done:request'];
    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/category:detail/);
    meta.stage_vocab.names = ['done:request', 'done:request'];
    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/duplicate stage names/);
  });

  it('rejects a worker roster that does not cover every GPU exactly once', () => {
    const meta = minimalV1();
    const workers = meta.workers as Array<{ gpu_ids: number[] }>;
    workers[1].gpu_ids = [0];

    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/worker placement must cover every GPU/);
  });
});
