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
  it('validates the real v3 metadata without collapsing same-numbered workers', () => {
    const meta = parseAnalyzerV1RunMeta(runMetaJson);

    expect(meta.schema_version).toBe(3);
    expect(meta.num_gpus).toBe(48);
    expect(meta.workers).toHaveLength(10);
    expect(meta.workers.filter((worker) => worker.worker_id === 0)).toHaveLength(2);
  });

  it('accepts the confirmed legacy v1 shape with composite numeric ownership', () => {
    expect(parseAnalyzerV1RunMeta(minimalV1()).workers).toHaveLength(2);
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
