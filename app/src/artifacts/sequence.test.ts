import { describe, expect, it } from 'vitest';

import type { OperationSummary, WorkerOperationBuffer } from './ref';
import {
  createOperationViewportState,
  OPERATION_BUFFER_SIZE,
  OPERATION_VIEWPORT_SIZE,
  moveOperationViewport,
  rejectOperationBufferRequest,
  resolveOperationBufferRequest,
  shiftOperationViewport,
} from './sequence';

function operations(offset: number, count: number): readonly OperationSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = offset + index;
    return {
      ordinal,
      ref: { iterId: String(Math.floor(ordinal / 4)), batchId: '0', operationId: String(ordinal) },
      section: 'ffn',
      layer: ordinal % 62,
      startMs: ordinal * 2,
      endMs: ordinal * 2 + 1,
    };
  });
}

function buffer(offset = 0, total = 1024): WorkerOperationBuffer {
  return {
    worker: { poolTag: 'ffn', workerId: '0' },
    workerKind: 'afd_ffn',
    batchRole: 'slot',
    span: { startMs: 0, endMs: total * 2 },
    offset,
    total,
    operations: operations(offset, Math.min(OPERATION_BUFFER_SIZE, total - offset)),
  };
}

describe('worker operation viewport buffer', () => {
  it('requires one contiguous bounded 192-operation buffer', () => {
    expect(createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE)).toMatchObject({
      viewportOffset: OPERATION_VIEWPORT_SIZE,
      pending: null,
      buffer: { offset: 0 },
    });
    expect(() =>
      createOperationViewportState(
        { ...buffer(), operations: [...operations(0, 8), ...operations(9, 1)] },
        0,
      ),
    ).toThrow(/contiguous/);
  });

  it('accepts an unaligned seek viewport centered within its buffer', () => {
    const seekBuffer = buffer(937, 2000);
    const state = createOperationViewportState(seekBuffer, 1001);
    expect(state.viewportOffset - state.buffer.offset).toBe(OPERATION_VIEWPORT_SIZE);
    const transition = shiftOperationViewport(state, 'next');
    expect(transition.state.viewportOffset).toBe(1065);
    expect(transition.request).toEqual({
      requestId: 0,
      direction: 'next',
      offset: 1129,
      limit: 64,
    });
  });

  it('moves to the buffered next viewport and requests only the new right chunk', () => {
    const initial = createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE);
    const transition = shiftOperationViewport(initial, 'next');

    expect(transition.state.viewportOffset).toBe(128);
    expect(transition.request).toEqual({ requestId: 0, direction: 'next', offset: 192, limit: 64 });
    expect(transition.state.buffer).toBe(initial.buffer);
  });

  it('maps a partial drag to an exact operation offset without fetching', () => {
    const initial = createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE);
    const transition = moveOperationViewport(initial, 16);

    expect(transition.state.viewportOffset).toBe(80);
    expect(transition.request).toBeNull();
  });

  it('clamps a long drag at the resident edge and refills only that direction', () => {
    const initial = createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE);
    const transition = moveOperationViewport(initial, 10_000);

    expect(transition.state.viewportOffset).toBe(128);
    expect(transition.request).toEqual({ requestId: 0, direction: 'next', offset: 192, limit: 64 });
  });

  it('publishes the right refill and evicts exactly the old left side', () => {
    const transition = shiftOperationViewport(
      createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE),
      'next',
    );
    if (transition.request === null) throw new Error('Expected directional request.');
    const resolved = resolveOperationBufferRequest(
      transition.state,
      transition.request,
      operations(192, 64),
    );

    expect(resolved).toMatchObject({ viewportOffset: 128, pending: null });
    expect(resolved.buffer.offset).toBe(64);
    expect(resolved.buffer.operations).toHaveLength(192);
    expect(resolved.buffer.operations[0]?.ordinal).toBe(64);
    expect(resolved.buffer.operations.at(-1)?.ordinal).toBe(255);
  });

  it('mirrors refill and eviction when moving to the previous viewport', () => {
    const initial = createOperationViewportState(buffer(64), 128);
    const transition = shiftOperationViewport(initial, 'previous');
    expect(transition.request).toEqual({
      requestId: 0,
      direction: 'previous',
      offset: 0,
      limit: 64,
    });
    if (transition.request === null) throw new Error('Expected directional request.');
    const resolved = resolveOperationBufferRequest(
      transition.state,
      transition.request,
      operations(0, 64),
    );

    expect(resolved.viewportOffset).toBe(64);
    expect(resolved.buffer.offset).toBe(0);
    expect(resolved.buffer.operations.at(-1)?.ordinal).toBe(191);
  });

  it('keeps the old buffer while pending and ignores stale responses', () => {
    const initial = createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE);
    const transition = shiftOperationViewport(initial, 'next');
    expect(shiftOperationViewport(transition.state, 'next')).toEqual({
      state: transition.state,
      request: null,
    });
    const stale = { requestId: 99, direction: 'previous' as const, offset: 0, limit: 64 };
    expect(resolveOperationBufferRequest(transition.state, stale, operations(0, 64))).toBe(
      transition.state,
    );
    expect(transition.state.buffer).toBe(initial.buffer);
  });

  it('can retry the same directional refill after a failed request', () => {
    const transition = shiftOperationViewport(
      createOperationViewportState(buffer(), OPERATION_VIEWPORT_SIZE),
      'next',
    );
    if (transition.request === null) throw new Error('Expected directional request.');
    const rejected = rejectOperationBufferRequest(transition.state, transition.request);
    expect(rejected).toMatchObject({ viewportOffset: 128, pending: null });
    const retry = shiftOperationViewport(rejected, 'next');
    expect(retry.request).toEqual({
      ...transition.request,
      requestId: transition.request.requestId + 1,
    });
    expect(
      resolveOperationBufferRequest(retry.state, transition.request, operations(192, 64)),
    ).toBe(retry.state);
  });

  it('clamps navigation when no complete neighboring viewport is buffered', () => {
    const atStart = createOperationViewportState(buffer(0, 100), 0);
    expect(shiftOperationViewport(atStart, 'previous')).toEqual({ state: atStart, request: null });
    const atEnd = createOperationViewportState(buffer(0, 100), 64);
    expect(shiftOperationViewport(atEnd, 'next')).toEqual({ state: atEnd, request: null });
  });

  it('supports seek buffers clamped at the global start and end', () => {
    expect(createOperationViewportState(buffer(0, 192), 0).viewportOffset).toBe(0);
    const endBuffer = buffer(808, 1000);
    expect(createOperationViewportState(endBuffer, 936).viewportOffset).toBe(936);
  });
});
