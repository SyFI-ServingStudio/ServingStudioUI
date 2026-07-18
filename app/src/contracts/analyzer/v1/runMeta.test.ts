import { describe, expect, it } from 'vitest';

import runMetaJson from '../../../../../fixtures/analyzer-v1/afd-qwen3-duration-reached/raw/run_meta.json';
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
  it('validates the real v4 metadata without collapsing same-numbered workers', () => {
    const meta = parseAnalyzerV1RunMeta(runMetaJson);

    expect(meta.schema_version).toBe(4);
    expect(meta.num_gpus).toBe(48);
    expect(meta.workers).toHaveLength(10);
    expect(meta.workers.filter((worker) => worker.worker_id === 0)).toHaveLength(2);
    // v4: every worker (incl. non-KV ffn) carries an authoritative, non-null tag.
    expect(meta.workers.every((worker) => 'pool_tag' in worker && worker.pool_tag)).toBe(true);
  });

  it('accepts the confirmed legacy v1 shape with composite numeric ownership', () => {
    expect(parseAnalyzerV1RunMeta(minimalV1()).workers).toHaveLength(2);
  });

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
        names: ['pending', 'done:request', 'done:request'],
      },
    };

    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/category:detail|duplicate stage names/);
  });

  it('rejects a worker roster that does not cover every GPU exactly once', () => {
    const meta = minimalV1();
    const workers = meta.workers as Array<{ gpu_ids: number[] }>;
    workers[1].gpu_ids = [0];

    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/worker placement must cover every GPU/);
  });

  it('rejects unknown fields for a versioned metadata shape', () => {
    const meta = minimalV1();
    meta.future = true;

    expect(() => parseAnalyzerV1RunMeta(meta)).toThrow(/<root>: Unrecognized key.*future/);
  });
});
