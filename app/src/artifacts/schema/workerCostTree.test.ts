import { describe, expect, it } from 'vitest';

import { workerCostTreeRef } from '../ref';
import { IncompatibleWorkerCostTreeError, parseWorkerCostTree } from './workerCostTree';

const RUN = { kind: 'run', id: 'run-1', workspace: 'w_main', revision: 'analysis-v2' } as const;
const PATH = [
  { at: 'pool', role: 'ffn' },
  { at: 'worker', id: '2' },
  { at: 'operation', iter: '17', batch: '3', op: 'ffn_0' },
] as const;
const REF = workerCostTreeRef(RUN, PATH);

function body() {
  return {
    schema_version: 1,
    identity: {
      pool_tag: 'ffn',
      worker_id: 2,
      iter_id: 17,
      batch_id: 3,
      operation_id: 'ffn_0',
      section: 'ffn',
      layer: 4,
    },
    interval: { start_ms: 12, end_ms: 13.5 },
    inputs: [
      {
        section: 'ffn',
        layer: 4,
        groups: [
          {
            batch_tokens: 8,
            prefill_tokens: 3,
            decode_request_count: 5,
            decode_kv_total: 21,
            prefill_chunk_pairs: [[2, 3]],
          },
        ],
      },
    ],
    tree: {
      kind: 'leaf',
      slot: {
        name: 'ffn.gemm',
        kind: 'single_gemm',
        kernel_config: { m: 8 },
        backend: 'torch',
      },
      base: 1.5,
      stats: { input: { m: 8 }, flops: 10, bytes: 20, tflops: 0.1, gbps: 0.2 },
    },
  };
}

describe('parseWorkerCostTree', () => {
  it('preserves the exact identity, inputs, interval, and validated raw tree', () => {
    expect(parseWorkerCostTree(body(), REF)).toEqual({
      worker: { poolTag: 'ffn', workerId: '2' },
      operation: { iterId: '17', batchId: '3', operationId: 'ffn_0' },
      section: 'ffn',
      layer: 4,
      interval: { startMs: 12, endMs: 13.5 },
      inputs: [
        {
          section: 'ffn',
          layer: 4,
          groups: [
            {
              batchTokens: 8,
              prefillTokens: 3,
              decodeRequestCount: 5,
              decodeKvTotal: 21,
              prefillChunkPairs: [[2, 3]],
            },
          ],
        },
      ],
      tree: body().tree,
    });
  });

  it('rejects a valid document served under another exact operation', () => {
    const substituted = body();
    substituted.identity.operation_id = 'ffn_1';
    expect(() => parseWorkerCostTree(substituted, REF)).toThrowError(
      IncompatibleWorkerCostTreeError,
    );
    expect(() => parseWorkerCostTree(substituted, REF)).toThrow(/asked for ffn\/2\/17\/3\/ffn_0/);
  });

  it('reports transport and recursive CostTree failures as incompatible', () => {
    const malformed = body();
    malformed.tree.base = -1;
    expect(() => parseWorkerCostTree(malformed, REF)).toThrow(/Invalid CostTree.*base/);
  });

  it('rejects finite inputs whose derived sum or nested scale overflows', () => {
    const sumOverflow = body();
    sumOverflow.tree = {
      kind: 'sum',
      children: [sumOverflow.tree, { ...sumOverflow.tree, base: Number.MAX_VALUE }],
    } as unknown as typeof sumOverflow.tree;
    (sumOverflow.tree as unknown as { children: Array<{ base: number }> }).children[0].base =
      Number.MAX_VALUE;
    expect(() => parseWorkerCostTree(sumOverflow, REF)).toThrow(/derived numeric value overflowed/);

    const scaleOverflow = body();
    scaleOverflow.tree.base = 0;
    let nestedScale: unknown = scaleOverflow.tree;
    for (let depth = 0; depth < 35; depth += 1) {
      nestedScale = { kind: 'scale', n: 0xffff_ffff, children: [nestedScale] };
    }
    scaleOverflow.tree = nestedScale as typeof scaleOverflow.tree;
    expect(() => parseWorkerCostTree(scaleOverflow, REF)).toThrow(
      /derived numeric value overflowed/,
    );
  });
});
