/** Analyzer-v1 wire contract for a bounded worker operation sequence. */
import { z } from 'zod';

import type {
  OperationSummary,
  WorkerCoordinate,
  WorkerOperationBuffer,
  WorkerOperationSeekResult,
} from '../ref';

export const WORKER_OPERATION_SCHEMA_VERSION = 1;
export const OPERATION_VIEWPORT_SIZE = 64;
export const OPERATION_BUFFER_SIZE = OPERATION_VIEWPORT_SIZE * 3;
export const MAX_OPERATION_RANGE = OPERATION_BUFFER_SIZE * 2;

const finiteNonNegative = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative().safe();
const integer = z.number().int().safe();
const decimalId = z.union([nonNegativeInteger, z.string().regex(/^(0|[1-9]\d*)$/)]);
const routeToken = z.string().regex(/^[A-Za-z0-9_-]+$/);
const nonEmptyString = z.string().min(1);

const workerSchema = z.object({ pool_tag: routeToken, worker_id: decimalId }).strict();
const workerKindSchema = z.enum(['afd_attn', 'afd_ffn', 'iterwise']);
const batchRoleSchema = z.enum(['slot', 'batch']);
const intervalSchema = z
  .object({ start_ms: finiteNonNegative, end_ms: finiteNonNegative })
  .strict()
  .refine((interval) => interval.end_ms >= interval.start_ms, {
    path: ['end_ms'],
    message: 'end_ms must be greater than or equal to start_ms',
  });
const operationSchema = z
  .object({
    ordinal: nonNegativeInteger,
    iter_id: decimalId,
    batch_id: decimalId,
    operation_id: routeToken,
    section: nonEmptyString,
    layer: integer,
    start_ms: finiteNonNegative,
    end_ms: finiteNonNegative,
  })
  .strict()
  .refine((operation) => operation.end_ms >= operation.start_ms, {
    path: ['end_ms'],
    message: 'operation end_ms must be greater than or equal to start_ms',
  });

const rangeSchema = z
  .object({
    schema_version: z.literal(WORKER_OPERATION_SCHEMA_VERSION),
    worker: workerSchema,
    worker_kind: workerKindSchema,
    batch_role: batchRoleSchema,
    total_operations: nonNegativeInteger,
    span: intervalSchema,
    range: z
      .object({
        offset: nonNegativeInteger,
        limit: nonNegativeInteger.min(1).max(MAX_OPERATION_RANGE),
        returned: nonNegativeInteger.max(MAX_OPERATION_RANGE),
      })
      .strict(),
    operations: z.array(operationSchema).max(MAX_OPERATION_RANGE),
  })
  .strict()
  .superRefine((range, context) => {
    validateOperationRange(
      range.operations,
      range.range,
      range.total_operations,
      range.span,
      context,
      ['operations'],
    );
  });

const seekSchema = z
  .object({
    schema_version: z.literal(WORKER_OPERATION_SCHEMA_VERSION),
    worker: workerSchema,
    worker_kind: workerKindSchema,
    batch_role: batchRoleSchema,
    at_ms: finiteNonNegative,
    total_operations: nonNegativeInteger.min(1),
    span: intervalSchema,
    hits: z.array(operationSchema),
    anchor: z.object({ ordinal: nonNegativeInteger, kind: z.enum(['hit', 'nearest']) }).strict(),
    suggested_viewport: z
      .object({ offset: nonNegativeInteger, limit: z.literal(OPERATION_VIEWPORT_SIZE) })
      .strict(),
    buffer: z
      .object({
        offset: nonNegativeInteger,
        limit: z.literal(OPERATION_BUFFER_SIZE),
        returned: nonNegativeInteger.max(OPERATION_BUFFER_SIZE),
        operations: z.array(operationSchema).max(OPERATION_BUFFER_SIZE),
      })
      .strict(),
  })
  .strict()
  .superRefine((seek, context) => {
    validateOperationRange(
      seek.buffer.operations,
      seek.buffer,
      seek.total_operations,
      seek.span,
      context,
      ['buffer', 'operations'],
    );
    if (seek.anchor.ordinal >= seek.total_operations) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor', 'ordinal'],
        message: 'anchor ordinal must be below total_operations',
      });
    }
    if (
      seek.suggested_viewport.offset >= seek.total_operations ||
      seek.suggested_viewport.offset < seek.buffer.offset ||
      seek.suggested_viewport.offset >= seek.buffer.offset + seek.buffer.returned
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suggested_viewport', 'offset'],
        message: 'suggested viewport must start inside the returned buffer',
      });
    }
    if (
      seek.anchor.ordinal < seek.buffer.offset ||
      seek.anchor.ordinal >= seek.buffer.offset + seek.buffer.returned
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anchor', 'ordinal'],
        message: 'anchor ordinal must be present in the returned buffer',
      });
    }
    seek.hits.forEach((hit, index) => {
      if (!(hit.start_ms <= seek.at_ms && seek.at_ms < hit.end_ms)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hits', index],
          message: 'seek hit must contain at_ms in its half-open interval',
        });
      }
    });
  });

function validateOperationRange(
  operations: readonly z.infer<typeof operationSchema>[],
  range: { offset: number; limit: number; returned: number },
  total: number,
  span: { start_ms: number; end_ms: number },
  context: z.RefinementCtx,
  path: (string | number)[],
): void {
  if (range.returned !== operations.length || range.returned > range.limit) {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message: 'invalid returned count' });
  }
  if (range.offset + range.returned > total) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'range exceeds total_operations',
    });
  }
  operations.forEach((operation, index) => {
    if (operation.ordinal !== range.offset + index) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'ordinal'],
        message: 'operation ordinals must be contiguous from range offset',
      });
    }
    if (operation.start_ms < span.start_ms || operation.end_ms > span.end_ms) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index],
        message: 'operation interval must lie inside worker span',
      });
    }
  });
}

export class IncompatibleWorkerOperationError extends Error {
  readonly received: number | undefined;
  readonly issues: readonly string[];

  constructor(message: string, received: number | undefined, issues: readonly string[]) {
    super(message);
    this.name = 'IncompatibleWorkerOperationError';
    this.received = received;
    this.issues = issues;
  }
}

const issueText = (issue: z.ZodIssue): string =>
  `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`;

function incompatible(input: unknown, error: z.ZodError): IncompatibleWorkerOperationError {
  const received =
    typeof input === 'object' && input !== null && 'schema_version' in input
      ? Number(Reflect.get(input, 'schema_version'))
      : undefined;
  return new IncompatibleWorkerOperationError(
    'Worker operation payload is incompatible with this UI.',
    Number.isSafeInteger(received) ? received : undefined,
    error.issues.map(issueText),
  );
}

const asId = (value: string | number): string => String(value);
const sameWorker = (left: WorkerCoordinate, right: WorkerCoordinate): boolean =>
  left.poolTag === right.poolTag && left.workerId === right.workerId;

function decodeWorker(input: z.infer<typeof workerSchema>, expected: WorkerCoordinate) {
  const worker = Object.freeze({ poolTag: input.pool_tag, workerId: asId(input.worker_id) });
  if (!sameWorker(worker, expected)) {
    throw new IncompatibleWorkerOperationError(
      'Worker operation identity does not match its sequence address.',
      WORKER_OPERATION_SCHEMA_VERSION,
      ['worker: response worker differs from the requested worker'],
    );
  }
  return worker;
}

function decodeOperation(operation: z.infer<typeof operationSchema>): OperationSummary {
  return Object.freeze({
    ordinal: operation.ordinal,
    ref: Object.freeze({
      iterId: asId(operation.iter_id),
      batchId: asId(operation.batch_id),
      operationId: operation.operation_id,
    }),
    section: operation.section,
    layer: operation.layer,
    startMs: operation.start_ms,
    endMs: operation.end_ms,
  });
}

export function parseWorkerOperationRange(
  input: unknown,
  expectedWorker: WorkerCoordinate,
  expectedOffset: number,
  expectedLimit: number,
): WorkerOperationBuffer {
  const parsed = rangeSchema.safeParse(input);
  if (!parsed.success) throw incompatible(input, parsed.error);
  const range = parsed.data;
  if (range.range.offset !== expectedOffset || range.range.limit !== expectedLimit) {
    throw new IncompatibleWorkerOperationError(
      'Worker operation range response does not match the requested window.',
      WORKER_OPERATION_SCHEMA_VERSION,
      [
        `range: expected offset ${expectedOffset} and limit ${expectedLimit}, received offset ${range.range.offset} and limit ${range.range.limit}`,
      ],
    );
  }
  return Object.freeze({
    worker: decodeWorker(range.worker, expectedWorker),
    workerKind: range.worker_kind,
    batchRole: range.batch_role,
    span: Object.freeze({ startMs: range.span.start_ms, endMs: range.span.end_ms }),
    offset: range.range.offset,
    total: range.total_operations,
    operations: Object.freeze(range.operations.map(decodeOperation)),
  });
}

export function parseWorkerOperationSeek(
  input: unknown,
  expectedWorker: WorkerCoordinate,
  expectedAtMs: number,
): WorkerOperationSeekResult {
  const parsed = seekSchema.safeParse(input);
  if (!parsed.success) throw incompatible(input, parsed.error);
  const seek = parsed.data;
  if (seek.at_ms !== expectedAtMs) {
    throw new IncompatibleWorkerOperationError(
      'Worker operation seek response does not match the requested cursor.',
      WORKER_OPERATION_SCHEMA_VERSION,
      [`at_ms: expected ${expectedAtMs}, received ${seek.at_ms}`],
    );
  }
  const worker = decodeWorker(seek.worker, expectedWorker);
  const span = Object.freeze({ startMs: seek.span.start_ms, endMs: seek.span.end_ms });
  return Object.freeze({
    worker,
    workerKind: seek.worker_kind,
    batchRole: seek.batch_role,
    atMs: seek.at_ms,
    totalOperations: seek.total_operations,
    span,
    hits: Object.freeze(seek.hits.map(decodeOperation)),
    anchor: Object.freeze(seek.anchor),
    suggestedViewport: Object.freeze({
      offset: seek.suggested_viewport.offset,
      limit: seek.suggested_viewport.limit,
    }),
    buffer: Object.freeze({
      worker,
      workerKind: seek.worker_kind,
      batchRole: seek.batch_role,
      span,
      offset: seek.buffer.offset,
      total: seek.total_operations,
      operations: Object.freeze(seek.buffer.operations.map(decodeOperation)),
    }),
  });
}
