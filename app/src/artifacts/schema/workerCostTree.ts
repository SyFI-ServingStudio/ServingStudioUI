import { z } from 'zod';

import type { WorkerCoordinate, WorkerCostTreeDetail, WorkerCostTreeRef } from '../ref';
import { parseRawCostNode } from './costTree';

export const WORKER_COST_TREE_SCHEMA_VERSION = 1;

export class IncompatibleWorkerCostTreeError extends Error {
  readonly received: number | undefined;
  readonly issues: readonly string[];

  constructor(issues: readonly string[], received?: number) {
    super(
      `worker CostTree payload is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatibleWorkerCostTreeError';
    this.received = received;
    this.issues = issues;
  }
}

const finiteNonNegative = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative().safe();
const integer = z.number().int().safe();
const decimalId = z.union([nonNegativeInteger, z.string().regex(/^(0|[1-9]\d*)$/)]);
const routeToken = z.string().regex(/^[A-Za-z0-9_-]+$/);
const nonEmptyString = z.string().min(1);
const intervalSchema = z
  .object({ start_ms: finiteNonNegative, end_ms: finiteNonNegative })
  .strict()
  .refine((interval) => interval.end_ms >= interval.start_ms, {
    path: ['end_ms'],
    message: 'end_ms must be greater than or equal to start_ms',
  });

export const costTreeGroupInputSchema = z
  .object({
    batch_tokens: nonNegativeInteger,
    prefill_tokens: nonNegativeInteger,
    decode_request_count: nonNegativeInteger,
    decode_kv_total: nonNegativeInteger,
    prefill_chunk_pairs: z.array(z.tuple([nonNegativeInteger, nonNegativeInteger])),
  })
  .strict();

export const exactCostTreeBodySchema = z.object({
  interval: intervalSchema,
  inputs: z.array(
    z
      .object({
        section: nonEmptyString,
        layer: integer.nullable(),
        groups: z.array(costTreeGroupInputSchema),
      })
      .strict(),
  ),
  tree: z.unknown(),
});

const exactCostTreeSchema = exactCostTreeBodySchema
  .extend({
    schema_version: z.literal(WORKER_COST_TREE_SCHEMA_VERSION),
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
  })
  .strict();

const asId = (value: string | number): string => String(value);
const sameWorker = (left: WorkerCoordinate, right: WorkerCoordinate): boolean =>
  left.poolTag === right.poolTag && left.workerId === right.workerId;

export function decodeRawExactCostTreeBody(
  detail: z.infer<typeof exactCostTreeBodySchema>,
): Pick<WorkerCostTreeDetail, 'interval' | 'inputs' | 'tree'> {
  return {
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
    tree: parseRawCostNode(detail.tree),
  };
}

export function parseWorkerCostTree(
  input: unknown,
  expected: Pick<WorkerCostTreeRef, 'worker' | 'operation'>,
): WorkerCostTreeDetail {
  const parsed = exactCostTreeSchema.safeParse(input);
  if (!parsed.success) {
    const received =
      typeof input === 'object' && input !== null && 'schema_version' in input
        ? Number(input.schema_version)
        : undefined;
    throw new IncompatibleWorkerCostTreeError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      Number.isFinite(received) ? received : undefined,
    );
  }
  const detail = parsed.data;
  const actualWorker = {
    poolTag: detail.identity.pool_tag,
    workerId: asId(detail.identity.worker_id),
  };
  const actualOperation = {
    iterId: asId(detail.identity.iter_id),
    batchId: asId(detail.identity.batch_id),
    operationId: detail.identity.operation_id,
  };
  if (
    !sameWorker(actualWorker, expected.worker) ||
    actualOperation.iterId !== expected.operation.iterId ||
    actualOperation.batchId !== expected.operation.batchId ||
    actualOperation.operationId !== expected.operation.operationId
  ) {
    throw new IncompatibleWorkerCostTreeError(
      [
        `identity: describes ${actualWorker.poolTag}/${actualWorker.workerId}/${actualOperation.iterId}/${actualOperation.batchId}/${actualOperation.operationId}, asked for ${expected.worker.poolTag}/${expected.worker.workerId}/${expected.operation.iterId}/${expected.operation.batchId}/${expected.operation.operationId}`,
      ],
      WORKER_COST_TREE_SCHEMA_VERSION,
    );
  }
  try {
    return Object.freeze({
      worker: expected.worker,
      operation: expected.operation,
      section: detail.identity.section,
      layer: detail.identity.layer,
      ...decodeRawExactCostTreeBody(detail),
    });
  } catch (error) {
    throw new IncompatibleWorkerCostTreeError(
      [`tree: ${error instanceof Error ? error.message : String(error)}`],
      WORKER_COST_TREE_SCHEMA_VERSION,
    );
  }
}
