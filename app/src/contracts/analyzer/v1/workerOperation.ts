import { z } from 'zod';

import { annotate } from '../../../domain/cost-tree';
import type {
  OperationSummary,
  WorkerCostTreeDetail,
  WorkerCostTreeRef,
  WorkerOperationBuffer,
  WorkerOperationSeekResult,
} from '../../../domain/workerOperation';
import type { WorkerRef } from '../../../domain/worker';

const MAX_OPERATION_RANGE = 384;
const OPERATION_SEEK_BUFFER_SIZE = 192;
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
    schema_version: z.literal(1),
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
    schema_version: z.literal(1),
    worker: workerSchema,
    worker_kind: workerKindSchema,
    batch_role: batchRoleSchema,
    at_ms: finiteNonNegative,
    total_operations: nonNegativeInteger.min(1),
    span: intervalSchema,
    hits: z.array(operationSchema),
    anchor: z.object({ ordinal: nonNegativeInteger, kind: z.enum(['hit', 'nearest']) }).strict(),
    suggested_viewport: z
      .object({ offset: nonNegativeInteger, limit: nonNegativeInteger.min(1) })
      .strict(),
    buffer: z
      .object({
        offset: nonNegativeInteger,
        limit: z.literal(OPERATION_SEEK_BUFFER_SIZE),
        returned: nonNegativeInteger.max(OPERATION_SEEK_BUFFER_SIZE),
        operations: z.array(operationSchema).max(OPERATION_SEEK_BUFFER_SIZE),
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

const groupInputSchema = z
  .object({
    batch_tokens: nonNegativeInteger,
    prefill_tokens: nonNegativeInteger,
    decode_request_count: nonNegativeInteger,
    decode_kv_total: nonNegativeInteger,
    prefill_chunk_pairs: z.array(z.tuple([nonNegativeInteger, nonNegativeInteger])),
  })
  .strict();
const exactCostTreeSchema = z
  .object({
    schema_version: z.literal(1),
    identity: z
      .object({
        pool_tag: routeToken,
        worker_id: decimalId,
        iter_id: decimalId,
        batch_id: decimalId,
        operation_id: routeToken,
        section: nonEmptyString,
        layer: integer,
      })
      .strict(),
    interval: intervalSchema,
    inputs: z.array(
      z
        .object({
          section: nonEmptyString,
          layer: integer.nullable(),
          groups: z.array(groupInputSchema),
        })
        .strict(),
    ),
    tree: z.unknown(),
  })
  .strict();

const asId = (value: string | number): string => String(value);
const sameWorker = (left: WorkerRef, right: WorkerRef): boolean =>
  left.poolTag === right.poolTag && left.workerId === right.workerId;

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

function decodeWorker(input: z.infer<typeof workerSchema>, expected: WorkerRef): WorkerRef {
  const worker = Object.freeze({ poolTag: input.pool_tag, workerId: asId(input.worker_id) });
  if (!sameWorker(worker, expected)) throw new Error('Worker operation identity mismatch.');
  return worker;
}

export function parseAnalyzerV1WorkerOperationRange(
  input: unknown,
  expectedWorker: WorkerRef,
): WorkerOperationBuffer {
  const range = rangeSchema.parse(input);
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

export function parseAnalyzerV1WorkerOperationSeek(
  input: unknown,
  expectedWorker: WorkerRef,
  expectedAtMs: number,
  expectedViewportLimit: number,
): WorkerOperationSeekResult {
  const seek = seekSchema.parse(input);
  const worker = decodeWorker(seek.worker, expectedWorker);
  if (seek.at_ms !== expectedAtMs || seek.suggested_viewport.limit !== expectedViewportLimit) {
    throw new Error('Worker operation seek request identity mismatch.');
  }
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

export function parseAnalyzerV1WorkerCostTree(
  input: unknown,
  expected: WorkerCostTreeRef,
): WorkerCostTreeDetail {
  const detail = exactCostTreeSchema.parse(input);
  if (
    !sameWorker(
      { poolTag: detail.identity.pool_tag, workerId: asId(detail.identity.worker_id) },
      expected.worker,
    ) ||
    asId(detail.identity.iter_id) !== expected.iterId ||
    asId(detail.identity.batch_id) !== expected.batchId ||
    detail.identity.operation_id !== expected.operationId
  ) {
    throw new Error('Worker CostTree payload identity does not match the requested operation.');
  }
  return Object.freeze({
    ...expected,
    section: detail.identity.section,
    layer: detail.identity.layer,
    interval: Object.freeze({ startMs: detail.interval.start_ms, endMs: detail.interval.end_ms }),
    inputs: Object.freeze(
      detail.inputs.map((inputRow) =>
        Object.freeze({
          section: inputRow.section,
          layer: inputRow.layer,
          groups: Object.freeze(
            inputRow.groups.map((group) =>
              Object.freeze({
                batchTokens: group.batch_tokens,
                prefillTokens: group.prefill_tokens,
                decodeRequestCount: group.decode_request_count,
                decodeKvTotal: group.decode_kv_total,
                prefillChunkPairs: Object.freeze(
                  group.prefill_chunk_pairs.map(([prefix, append]) =>
                    Object.freeze([prefix, append] as const),
                  ),
                ),
              }),
            ),
          ),
        }),
      ),
    ),
    tree: annotate(detail.tree),
  });
}
