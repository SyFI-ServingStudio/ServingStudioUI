import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  operationSequenceWorker,
  sequenceKey,
  sequenceReadKey,
  type OperationSequenceRequest,
  type OperationSummary,
  type OperationsSeqRef,
  type WorkerOperationBuffer,
  type WorkerOperationSeekResult,
} from './ref';
import type { ArtifactResult } from './result';
import { artifactResultFromStatus, messageOf } from './client';
import {
  IncompatibleWorkerOperationError,
  MAX_OPERATION_RANGE,
  parseWorkerOperationRange,
  parseWorkerOperationSeek,
  WORKER_OPERATION_SCHEMA_VERSION,
} from './schema/operations';
import { sequenceUrl } from './url';
export { OPERATION_BUFFER_SIZE, OPERATION_VIEWPORT_SIZE } from './schema/operations';
import { OPERATION_BUFFER_SIZE, OPERATION_VIEWPORT_SIZE } from './schema/operations';

export type OperationBufferDirection = 'previous' | 'next';

export interface OperationBufferRequest {
  readonly requestId: number;
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
  /** Monotonic within this installed window, including failed retries. */
  readonly nextRequestId: number;
}

export interface OperationViewportTransition {
  readonly state: OperationViewportState;
  readonly request: OperationBufferRequest | null;
}

export type OperationSequenceValue<Q extends OperationSequenceRequest> = Q extends {
  readonly mode: 'seek';
}
  ? WorkerOperationSeekResult
  : WorkerOperationBuffer;

function assertRequest(request: OperationSequenceRequest): void {
  if (request.mode === 'range') {
    if (
      !Number.isSafeInteger(request.offset) ||
      request.offset < 0 ||
      !Number.isSafeInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > MAX_OPERATION_RANGE
    ) {
      throw new Error(
        `Operation range must have a non-negative offset and a 1–${MAX_OPERATION_RANGE} limit.`,
      );
    }
    return;
  }
  if (!Number.isFinite(request.atMs) || request.atMs < 0) {
    throw new Error('Operation seek time must be finite and non-negative.');
  }
}

/** Read one range or seek response without exposing transport failures. */
export async function fetchSequence<Q extends OperationSequenceRequest>(
  ref: OperationsSeqRef,
  request: Q,
  signal?: AbortSignal,
): Promise<ArtifactResult<OperationSequenceValue<Q>>> {
  assertRequest(request);
  const url = sequenceUrl(ref, request);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'failed', code: 'network', reason: messageOf(error) };
  }
  if (!response.ok) {
    return artifactResultFromStatus(response.status, response.statusText, url);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    return { status: 'failed', code: 'invalid_json', reason: messageOf(error) };
  }

  try {
    const worker = operationSequenceWorker(ref);
    const value =
      request.mode === 'range'
        ? parseWorkerOperationRange(body, worker, request.offset, request.limit)
        : parseWorkerOperationSeek(body, worker, request.atMs);
    return {
      status: 'ready',
      value: value as OperationSequenceValue<Q>,
      schemaVersion: WORKER_OPERATION_SCHEMA_VERSION,
      // Each range has a different body and therefore a different HTTP ETag.
      // The sequence's shared logical revision is supplied by its descriptor.
      revision: ref.result.revision ?? '',
    };
  } catch (error) {
    if (error instanceof IncompatibleWorkerOperationError) {
      return {
        status: 'incompatible',
        reason: error.message,
        received: error.received,
        issues: error.issues,
      };
    }
    throw error;
  }
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
  return Object.freeze({ buffer, viewportOffset, pending: null, nextRequestId: 0 });
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
  if (targetOffset >= state.buffer.total || targetEnd > bufferEnd(state.buffer)) {
    return { state, request: null };
  }

  const direction: OperationBufferDirection = operationDelta > 0 ? 'next' : 'previous';

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
          requestId: state.nextRequestId,
          direction,
          offset: requestOffset,
          limit: Math.min(OPERATION_VIEWPORT_SIZE, available),
        })
      : null;
  if (targetOffset === state.viewportOffset && request === null) {
    return { state, request: null };
  }
  return {
    state: Object.freeze({
      ...state,
      viewportOffset: targetOffset,
      pending: request,
      nextRequestId: request === null ? state.nextRequestId : state.nextRequestId + 1,
    }),
    request,
  };
}

function sameRequest(left: OperationBufferRequest | null, right: OperationBufferRequest): boolean {
  return (
    left !== null &&
    left.requestId === right.requestId &&
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
  return Object.freeze({
    buffer,
    viewportOffset: state.viewportOffset,
    pending: null,
    nextRequestId: state.nextRequestId,
  });
}

/** Release a failed request without changing the resident window. */
export function rejectOperationBufferRequest(
  state: OperationViewportState,
  request: OperationBufferRequest,
): OperationViewportState {
  return sameRequest(state.pending, request) ? Object.freeze({ ...state, pending: null }) : state;
}

export type SequenceWindowRequest =
  { readonly mode: 'start' } | { readonly mode: 'seek'; readonly atMs: number };

export interface OperationSequenceWindow {
  readonly viewport: OperationViewportState;
  readonly operations: readonly OperationSummary[];
  /** Present only for the seek that installed this window. */
  readonly seek: WorkerOperationSeekResult | null;
  /** A seek or refill is running while the current window remains visible. */
  readonly refreshing: boolean;
  /** A failed refresh does not erase the last usable window. */
  readonly refreshProblem: Exclude<ArtifactResult<never>, { status: 'pending' | 'ready' }> | null;
}

export interface SequenceWindowController {
  readonly result: ArtifactResult<OperationSequenceWindow>;
  shift(direction: OperationBufferDirection): void;
  move(operationDelta: number): void;
}

interface InstalledOperationWindow {
  readonly refKey: string;
  readonly viewport: OperationViewportState;
  readonly seek: WorkerOperationSeekResult | null;
}

type SequenceProblem = Exclude<ArtifactResult<never>, { status: 'pending' | 'ready' }>;

interface KeyedSequenceProblem {
  readonly refKey: string;
  /** Null for a refill problem, which remains relevant until the next move. */
  readonly readKey: string | null;
  readonly value: SequenceProblem;
}

const PENDING: ArtifactResult<never> = { status: 'pending' };

function visibleOperations(viewport: OperationViewportState): readonly OperationSummary[] {
  return viewport.buffer.operations.filter(
    (operation) =>
      operation.ordinal >= viewport.viewportOffset &&
      operation.ordinal < viewport.viewportOffset + OPERATION_VIEWPORT_SIZE,
  );
}

/**
 * Own the 64-visible/192-resident operation window for one worker.
 *
 * A new seek keeps the previous window mounted until its response arrives.
 * The effect compares the response's read key with the current request, so a
 * late response for an earlier cursor cannot replace the current window.
 */
export function useSequenceWindow(
  ref: OperationsSeqRef | null,
  request: SequenceWindowRequest | null,
): SequenceWindowController {
  const refKey = ref === null ? null : sequenceKey(ref);
  const requestMode = request?.mode ?? null;
  const requestAtMs = request?.mode === 'seek' ? request.atMs : null;
  const wireRequest = useMemo<OperationSequenceRequest | null>(
    () =>
      requestMode === null
        ? null
        : requestMode === 'start'
          ? { mode: 'range', offset: 0, limit: OPERATION_BUFFER_SIZE }
          : requestAtMs === null
            ? null
            : { mode: 'seek', atMs: requestAtMs },
    [requestAtMs, requestMode],
  );
  const readKey = ref === null || wireRequest === null ? null : sequenceReadKey(ref, wireRequest);
  const activeReadKey = useRef(readKey);
  activeReadKey.current = readKey;

  const [installed, setInstalled] = useState<InstalledOperationWindow | null>(null);
  const [problem, setProblem] = useState<KeyedSequenceProblem | null>(null);
  const current = installed?.refKey === refKey ? installed : null;
  const viewport = current?.viewport ?? null;
  const seek = current?.seek ?? null;
  const refreshProblem =
    problem?.refKey === refKey && (problem.readKey === null || problem.readKey === readKey)
      ? problem.value
      : null;

  useEffect(() => setProblem(null), [readKey]);

  const initial = useQuery({
    queryKey: ['sequence', readKey ?? 'disabled'],
    queryFn: ({ signal }) => {
      if (ref === null || wireRequest === null) {
        throw new Error('Cannot read a sequence without an address and request.');
      }
      return fetchSequence(ref, wireRequest, signal);
    },
    enabled: ref !== null && wireRequest !== null,
    retry: false,
  });

  useEffect(() => {
    if (
      readKey === null ||
      refKey === null ||
      activeReadKey.current !== readKey ||
      initial.data === undefined
    ) {
      return;
    }
    if (initial.data.status !== 'ready') {
      if (initial.data.status !== 'pending') {
        setProblem({ refKey, readKey, value: initial.data });
      }
      return;
    }
    const value = initial.data.value;
    if ('atMs' in value) {
      if (wireRequest?.mode !== 'seek' || value.atMs !== wireRequest.atMs) return;
      setInstalled({
        refKey,
        viewport: createOperationViewportState(value.buffer, value.suggestedViewport.offset),
        seek: value,
      });
    } else {
      if (wireRequest?.mode !== 'range') return;
      setInstalled({
        refKey,
        viewport: createOperationViewportState(value, value.offset),
        seek: null,
      });
    }
    setProblem(null);
  }, [initial.data, readKey, refKey, wireRequest]);

  const pendingRefill = viewport?.pending ?? null;
  const refillRequest: OperationSequenceRequest | null =
    pendingRefill === null
      ? null
      : { mode: 'range', offset: pendingRefill.offset, limit: pendingRefill.limit };
  const refillReadKey =
    ref === null || refillRequest === null ? null : sequenceReadKey(ref, refillRequest);
  const refillQueryKey =
    refillReadKey === null || pendingRefill === null
      ? null
      : `${refillReadKey}:${pendingRefill.requestId}`;
  const activeRefillKey = useRef(refillQueryKey);
  activeRefillKey.current = refillQueryKey;
  const refill = useQuery({
    queryKey: ['sequence', refillQueryKey ?? 'disabled-refill'],
    queryFn: ({ signal }) => {
      if (ref === null || refillRequest === null) {
        throw new Error('Cannot refill a sequence without a pending range.');
      }
      return fetchSequence(ref, refillRequest, signal);
    },
    enabled: ref !== null && refillRequest !== null,
    retry: false,
  });

  useEffect(() => {
    if (
      pendingRefill === null ||
      refillReadKey === null ||
      refillQueryKey === null ||
      refKey === null ||
      activeRefillKey.current !== refillQueryKey ||
      refill.data === undefined ||
      refill.data.status === 'pending'
    ) {
      return;
    }
    if (refill.data.status !== 'ready') {
      setProblem({ refKey, readKey: null, value: refill.data });
      setInstalled((installedWindow) =>
        installedWindow?.refKey !== refKey
          ? installedWindow
          : {
              ...installedWindow,
              viewport: rejectOperationBufferRequest(installedWindow.viewport, pendingRefill),
            },
      );
      return;
    }
    const operations = refill.data.value.operations;
    setInstalled((installedWindow) =>
      installedWindow?.refKey !== refKey
        ? installedWindow
        : {
            ...installedWindow,
            viewport: resolveOperationBufferRequest(
              installedWindow.viewport,
              pendingRefill,
              operations,
            ),
          },
    );
    setProblem(null);
  }, [pendingRefill, refKey, refill.data, refillQueryKey, refillReadKey]);

  const shift = useCallback(
    (direction: OperationBufferDirection) => {
      setProblem(null);
      setInstalled((installedWindow) =>
        installedWindow?.refKey !== refKey
          ? installedWindow
          : {
              ...installedWindow,
              viewport: shiftOperationViewport(installedWindow.viewport, direction).state,
            },
      );
    },
    [refKey],
  );
  const move = useCallback(
    (operationDelta: number) => {
      setProblem(null);
      setInstalled((installedWindow) =>
        installedWindow?.refKey !== refKey
          ? installedWindow
          : {
              ...installedWindow,
              viewport: moveOperationViewport(installedWindow.viewport, operationDelta).state,
            },
      );
    },
    [refKey],
  );

  const result = useMemo<ArtifactResult<OperationSequenceWindow>>(() => {
    if (ref === null || request === null) return PENDING;
    if (viewport === null) {
      const answer = initial.data;
      return answer === undefined || answer.status === 'ready' ? PENDING : answer;
    }
    return {
      status: 'ready',
      value: {
        viewport,
        operations: visibleOperations(viewport),
        seek,
        refreshing: initial.isPending || pendingRefill !== null,
        refreshProblem,
      },
      schemaVersion: WORKER_OPERATION_SCHEMA_VERSION,
      // Range ETags identify individual response bodies, so they cannot name
      // the whole sequence. The logical sequence revision comes from the run
      // descriptor and is carried by the ref.
      revision: ref.result.revision ?? '',
    };
  }, [
    initial.data,
    initial.isPending,
    pendingRefill,
    ref,
    refreshProblem,
    request,
    seek,
    viewport,
  ]);

  return useMemo(() => ({ result, shift, move }), [move, result, shift]);
}
