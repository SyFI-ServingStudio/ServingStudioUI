import { describe, expect, it } from 'vitest';

import {
  IncompatibleWorkerOperationError,
  OPERATION_BUFFER_SIZE,
  OPERATION_VIEWPORT_SIZE,
  parseWorkerOperationRange,
  parseWorkerOperationSeek,
} from './operations';

const WORKER = { poolTag: 'ffn', workerId: '2' } as const;

function operation(ordinal: number, startMs = ordinal): Record<string, unknown> {
  return {
    ordinal,
    iter_id: '17',
    batch_id: '9',
    operation_id: String(ordinal),
    section: 'bridge',
    layer: 3,
    start_ms: startMs,
    end_ms: startMs + 1,
  };
}

function rangeBody(offset = 4, count = 2): Record<string, unknown> {
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: 2 },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    total_operations: 20,
    span: { start_ms: 0, end_ms: 20 },
    range: { offset, limit: OPERATION_BUFFER_SIZE, returned: count },
    operations: Array.from({ length: count }, (_, index) => operation(offset + index)),
  };
}

function seekBody(atMs = 4.5): Record<string, unknown> {
  return {
    schema_version: 1,
    worker: { pool_tag: 'ffn', worker_id: '2' },
    worker_kind: 'afd_ffn',
    batch_role: 'slot',
    at_ms: atMs,
    total_operations: 20,
    span: { start_ms: 0, end_ms: 20 },
    hits: [operation(4, 4)],
    anchor: { ordinal: 4, kind: 'hit' },
    suggested_viewport: { offset: 4, limit: OPERATION_VIEWPORT_SIZE },
    buffer: {
      offset: 0,
      limit: OPERATION_BUFFER_SIZE,
      returned: 20,
      operations: Array.from({ length: 20 }, (_, ordinal) => operation(ordinal)),
    },
  };
}

describe('worker operation sequence schema', () => {
  it('preserves range identity, ordering, and exact operation coordinates', () => {
    expect(parseWorkerOperationRange(rangeBody(), WORKER, 4, OPERATION_BUFFER_SIZE)).toMatchObject({
      worker: WORKER,
      workerKind: 'afd_ffn',
      batchRole: 'slot',
      offset: 4,
      total: 20,
      operations: [
        { ordinal: 4, ref: { iterId: '17', batchId: '9', operationId: '4' } },
        { ordinal: 5, ref: { iterId: '17', batchId: '9', operationId: '5' } },
      ],
    });
  });

  it('preserves the server-selected seek anchor and resident buffer', () => {
    expect(parseWorkerOperationSeek(seekBody(), WORKER, 4.5)).toMatchObject({
      atMs: 4.5,
      hits: [{ ordinal: 4 }],
      anchor: { ordinal: 4, kind: 'hit' },
      suggestedViewport: { offset: 4, limit: 64 },
      buffer: { offset: 0, total: 20, operations: expect.any(Array) },
    });
  });

  it('rejects a different worker instead of serving it under this address', () => {
    expect(() =>
      parseWorkerOperationRange(
        rangeBody(),
        { poolTag: 'attn', workerId: '2' },
        4,
        OPERATION_BUFFER_SIZE,
      ),
    ).toThrow(IncompatibleWorkerOperationError);
  });

  it('rejects a self-consistent range that belongs to another request', () => {
    expect(() => parseWorkerOperationRange(rangeBody(4, 2), WORKER, 0, 192)).toThrow(/window/);
    expect(() => parseWorkerOperationRange(rangeBody(4, 2), WORKER, 4, 64)).toThrow(/window/);
  });

  it('rejects gaps, an anchor outside the buffer, and a stale seek cursor', () => {
    const gap = rangeBody();
    const gapOperations = gap.operations as Record<string, unknown>[];
    gapOperations[1] = operation(9);
    expect(() => parseWorkerOperationRange(gap, WORKER, 4, OPERATION_BUFFER_SIZE)).toThrow(
      /incompatible/,
    );

    const outside = seekBody();
    outside.anchor = { ordinal: 19, kind: 'nearest' };
    (outside.buffer as Record<string, unknown>).returned = 10;
    (outside.buffer as Record<string, unknown>).operations = Array.from(
      { length: 10 },
      (_, ordinal) => operation(ordinal),
    );
    expect(() => parseWorkerOperationSeek(outside, WORKER, 4.5)).toThrow(/incompatible/);

    expect(() => parseWorkerOperationSeek(seekBody(4.5), WORKER, 6)).toThrow(/cursor/);
  });
});
