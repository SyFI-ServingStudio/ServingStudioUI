import type { OperationSummary, WorkerOperationBuffer } from '../domain/workerOperation';

export const OPERATION_VIEWPORT_SIZE = 64;
export const OPERATION_BUFFER_SIZE = OPERATION_VIEWPORT_SIZE * 3;

export type OperationBufferDirection = 'previous' | 'next';

export interface OperationBufferRequest {
  readonly direction: OperationBufferDirection;
  readonly offset: number;
  readonly limit: number;
}

export interface OperationViewportState {
  readonly buffer: WorkerOperationBuffer;
  /** Global operation ordinal of the visible 64-operation viewport. */
  readonly viewportOffset: number;
  /** A directional refill never replaces the visible buffer until it resolves. */
  readonly pending: OperationBufferRequest | null;
}

export interface OperationViewportTransition {
  readonly state: OperationViewportState;
  readonly request: OperationBufferRequest | null;
}

function maximumViewportOffset(buffer: WorkerOperationBuffer): number {
  return Math.max(0, buffer.total - 1);
}

function bufferEnd(buffer: WorkerOperationBuffer): number {
  return buffer.offset + buffer.operations.length;
}

function assertBuffer(buffer: WorkerOperationBuffer): void {
  if (
    !Number.isSafeInteger(buffer.offset) ||
    buffer.offset < 0 ||
    !Number.isSafeInteger(buffer.total) ||
    buffer.total < 0 ||
    buffer.operations.length > OPERATION_BUFFER_SIZE ||
    bufferEnd(buffer) > buffer.total
  ) {
    throw new Error('Invalid bounded worker operation buffer.');
  }
  buffer.operations.forEach((operation, index) => {
    if (operation.ordinal !== buffer.offset + index) {
      throw new Error('Worker operation buffer ordinals must be contiguous.');
    }
  });
}

export function createOperationViewportState(
  buffer: WorkerOperationBuffer,
  viewportOffset: number,
): OperationViewportState {
  assertBuffer(buffer);
  if (
    !Number.isSafeInteger(viewportOffset) ||
    viewportOffset < buffer.offset ||
    viewportOffset >= Math.max(bufferEnd(buffer), 1)
  ) {
    throw new Error('Operation viewport must start inside its buffer.');
  }
  return Object.freeze({ buffer, viewportOffset, pending: null });
}

/** Moves immediately to an already-buffered neighbor, then requests only the
 * newly exposed directional chunk. The old 192-operation buffer remains intact
 * while that refill is pending, so neither timeline nor CostTree can blink. */
export function shiftOperationViewport(
  state: OperationViewportState,
  direction: OperationBufferDirection,
): OperationViewportTransition {
  const operationDelta = direction === 'next' ? OPERATION_VIEWPORT_SIZE : -OPERATION_VIEWPORT_SIZE;
  const targetOffset = state.viewportOffset + operationDelta;
  if (targetOffset < 0 || targetOffset >= state.buffer.total) {
    return { state, request: null };
  }
  return moveOperationViewport(state, operationDelta);
}

/** Moves by an operation count derived from a pointer drag. Navigation stays
 * inside the currently resident three-window buffer; reaching either resident
 * edge schedules exactly one directional 64-operation refill. */
export function moveOperationViewport(
  state: OperationViewportState,
  operationDelta: number,
): OperationViewportTransition {
  if (state.pending !== null) return { state, request: null };
  if (!Number.isSafeInteger(operationDelta) || operationDelta === 0) {
    return { state, request: null };
  }
  const residentMinimum = state.buffer.offset;
  const residentMaximum = Math.min(
    maximumViewportOffset(state.buffer),
    state.buffer.offset + OPERATION_VIEWPORT_SIZE * 2,
  );
  const targetOffset = Math.min(
    residentMaximum,
    Math.max(residentMinimum, state.viewportOffset + operationDelta),
  );
  const targetEnd = Math.min(state.buffer.total, targetOffset + OPERATION_VIEWPORT_SIZE);
  if (
    targetOffset === state.viewportOffset ||
    targetOffset >= state.buffer.total ||
    targetEnd > bufferEnd(state.buffer)
  ) {
    return { state, request: null };
  }

  const direction: OperationBufferDirection =
    targetOffset > state.viewportOffset ? 'next' : 'previous';

  const requestOffset =
    direction === 'next'
      ? bufferEnd(state.buffer)
      : Math.max(0, state.buffer.offset - OPERATION_VIEWPORT_SIZE);
  const available =
    direction === 'next' ? state.buffer.total - requestOffset : state.buffer.offset - requestOffset;
  const reachedRefillEdge =
    direction === 'next'
      ? targetOffset === state.buffer.offset + OPERATION_VIEWPORT_SIZE * 2
      : targetOffset === state.buffer.offset;
  const request =
    reachedRefillEdge && available > 0
      ? Object.freeze({
          direction,
          offset: requestOffset,
          limit: Math.min(OPERATION_VIEWPORT_SIZE, available),
        })
      : null;
  return {
    state: Object.freeze({
      ...state,
      viewportOffset: targetOffset,
      pending: request,
    }),
    request,
  };
}

function sameRequest(left: OperationBufferRequest | null, right: OperationBufferRequest): boolean {
  return (
    left !== null &&
    left.direction === right.direction &&
    left.offset === right.offset &&
    left.limit === right.limit
  );
}

/** Publishes one completed directional chunk and evicts exactly the opposite
 * 64-operation side. Stale responses are harmless no-ops. */
export function resolveOperationBufferRequest(
  state: OperationViewportState,
  request: OperationBufferRequest,
  operations: readonly OperationSummary[],
): OperationViewportState {
  if (!sameRequest(state.pending, request)) return state;
  if (
    operations.length !== request.limit ||
    operations.some((operation, index) => operation.ordinal !== request.offset + index)
  ) {
    throw new Error('Directional operation chunk does not match its request.');
  }

  const kept =
    request.direction === 'next'
      ? state.buffer.operations.slice(OPERATION_VIEWPORT_SIZE)
      : state.buffer.operations.slice(0, -OPERATION_VIEWPORT_SIZE);
  const merged = request.direction === 'next' ? [...kept, ...operations] : [...operations, ...kept];
  const buffer = Object.freeze({
    ...state.buffer,
    offset:
      request.direction === 'next' ? state.buffer.offset + OPERATION_VIEWPORT_SIZE : request.offset,
    operations: Object.freeze(merged),
  });
  assertBuffer(buffer);
  return Object.freeze({ buffer, viewportOffset: state.viewportOffset, pending: null });
}
