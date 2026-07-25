import { z } from 'zod';

import type { KernelThroughputAnalysis } from '../../../domain/kernelThroughputAnalysis';
import type { JsonValue } from '../../../domain/cost-tree';
import type { WorkerCostTreeRef } from '../../../domain/workerOperation';

const decimalId = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^(0|[1-9]\d*)$/),
]);
const finite = z.number().finite();
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), finite, z.string(), z.array(jsonValue), z.record(jsonValue)]),
);
const wireSchema = z
  .object({
    schema_version: z.literal(1),
    identity: z
      .object({
        pool_tag: z.string().min(1),
        worker_id: decimalId,
        iter_id: decimalId,
        batch_id: decimalId,
        operation_id: decimalId,
        section: z.string().min(1),
        layer: z.number().int(),
      })
      .strict(),
    leaf_id: z.number().int().nonnegative().safe(),
    slot: z
      .object({
        name: z.string().min(1),
        kind: z.string().min(1),
        kernel_config: z.record(jsonValue),
        backend: z.string().nullable(),
      })
      .strict(),
    exact_input: jsonValue,
    describe_config: z.record(jsonValue),
    input_fields: z.array(z.string().min(1)).min(1),
    grid_axes: z.array(z.array(finite).min(1)).min(1),
    points: z.array(
      z
        .object({
          input: z.record(finite),
          time_ms: finite.nonnegative(),
          flops: finite.nonnegative(),
          bytes: finite.nonnegative(),
          energy_j: finite.nonnegative(),
          coverage: z.number().int().min(0).max(255),
        })
        .strict(),
    ),
    semantics: z.literal('cache_eval_at_declared_grid'),
  })
  .strict();

const asId = (value: string | number): string => String(value);

export function parseAnalyzerV1KernelThroughputAnalysis(
  input: unknown,
  expected: WorkerCostTreeRef,
  leafId: number,
): KernelThroughputAnalysis {
  const wire = wireSchema.parse(input);
  const actual = {
    poolTag: wire.identity.pool_tag,
    workerId: asId(wire.identity.worker_id),
    iterId: asId(wire.identity.iter_id),
    batchId: asId(wire.identity.batch_id),
    operationId: asId(wire.identity.operation_id),
  };
  if (
    actual.poolTag !== expected.worker.poolTag ||
    actual.workerId !== expected.worker.workerId ||
    actual.iterId !== expected.iterId ||
    actual.batchId !== expected.batchId ||
    actual.operationId !== expected.operationId ||
    wire.leaf_id !== leafId
  ) {
    throw new Error('Kernel throughput analysis identity does not match the selected leaf.');
  }
  if (wire.input_fields.length !== wire.grid_axes.length) {
    throw new Error('Kernel throughput analysis fields and axes are not aligned.');
  }
  const expectedPoints = wire.grid_axes.reduce((count, axis) => count * axis.length, 1);
  if (wire.points.length !== expectedPoints) {
    throw new Error('Kernel throughput analysis point count does not match its grid.');
  }
  return Object.freeze({
    schemaVersion: 1,
    worker: Object.freeze({ poolTag: actual.poolTag, workerId: actual.workerId }),
    iterId: actual.iterId,
    batchId: actual.batchId,
    operationId: actual.operationId,
    leafId: wire.leaf_id,
    slot: Object.freeze({
      name: wire.slot.name,
      kind: wire.slot.kind,
      kernelConfig: Object.freeze(wire.slot.kernel_config) as Readonly<Record<string, JsonValue>>,
      backend: wire.slot.backend,
    }),
    exactInput: wire.exact_input as KernelThroughputAnalysis['exactInput'],
    inputFields: Object.freeze(wire.input_fields),
    gridAxes: Object.freeze(wire.grid_axes.map((axis) => Object.freeze(axis))),
    points: Object.freeze(
      wire.points.map((point) =>
        Object.freeze({
          input: Object.freeze(point.input),
          timeMs: point.time_ms,
          flops: point.flops,
          bytes: point.bytes,
          energyJ: point.energy_j,
          coverage: point.coverage,
        }),
      ),
    ),
    semantics: wire.semantics,
  });
}
