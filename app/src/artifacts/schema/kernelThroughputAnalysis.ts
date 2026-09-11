import { z } from 'zod';

import type {
  JsonValue,
  KernelThroughputAnalysis,
  KernelThroughputAnalysisRef,
  PredictionKernelThroughputAnalysis,
  PredictionKernelThroughputAnalysisRef,
} from '../ref';

export const KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION = 1;

export class IncompatibleKernelThroughputAnalysisError extends Error {
  readonly received: number | undefined;
  readonly issues: readonly string[];

  constructor(issues: readonly string[], received?: number) {
    super(
      `kernel throughput analysis is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatibleKernelThroughputAnalysisError';
    this.received = received;
    this.issues = issues;
  }
}

const decimalId = z.union([
  z.number().int().nonnegative().safe(),
  z.string().regex(/^(0|[1-9]\d*)$/),
]);
const routeToken = z.string().regex(/^[A-Za-z0-9_-]+$/);
const finite = z.number().finite();
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), finite, z.string(), z.array(jsonValue), z.record(jsonValue)]),
);
const analysisBodySchema = z.object({
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
});
const workerWireSchema = analysisBodySchema
  .extend({
    schema_version: z.literal(KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION),
    identity: z
      .object({
        pool_tag: routeToken,
        worker_id: decimalId,
        iter_id: decimalId,
        batch_id: decimalId,
        operation_id: decimalId,
        section: z.string().min(1),
        layer: z.number().int(),
      })
      .strict(),
  })
  .strict();

const predictionWireSchema = analysisBodySchema
  .extend({
    schema_version: z.literal(KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION),
    identity: z
      .object({
        prediction_id: z.string().regex(/^p_[a-z0-9_]{1,64}$/),
        case_id: decimalId,
        operation_id: decimalId,
        section: z.string().min(1),
        layer: z.number().int(),
      })
      .strict(),
  })
  .strict();

const asId = (value: string | number): string => String(value);

function receivedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || !('schema_version' in input)) return undefined;
  const received = input.schema_version;
  return typeof received === 'number' && Number.isFinite(received) ? received : undefined;
}

function formatIssue(issue: z.ZodIssue): string {
  return `${issue.path.join('.') || '<root>'}: ${issue.message}`;
}

export function parseKernelThroughputAnalysis(
  input: unknown,
  expected: Pick<KernelThroughputAnalysisRef, 'worker' | 'operation' | 'leafId'>,
): KernelThroughputAnalysis {
  const parsed = workerWireSchema.safeParse(input);
  if (!parsed.success) {
    throw new IncompatibleKernelThroughputAnalysisError(
      parsed.error.issues.map(formatIssue),
      receivedVersion(input),
    );
  }
  const wire = parsed.data;
  const actual = {
    worker: { poolTag: wire.identity.pool_tag, workerId: asId(wire.identity.worker_id) },
    operation: {
      iterId: asId(wire.identity.iter_id),
      batchId: asId(wire.identity.batch_id),
      operationId: asId(wire.identity.operation_id),
    },
  };
  const expectedIdentity = `${expected.worker.poolTag}/${expected.worker.workerId}/${expected.operation.iterId}/${expected.operation.batchId}/${expected.operation.operationId}/leaf:${expected.leafId}`;
  const actualIdentity = `${actual.worker.poolTag}/${actual.worker.workerId}/${actual.operation.iterId}/${actual.operation.batchId}/${actual.operation.operationId}/leaf:${wire.leaf_id}`;
  if (
    actual.worker.poolTag !== expected.worker.poolTag ||
    actual.worker.workerId !== expected.worker.workerId ||
    actual.operation.iterId !== expected.operation.iterId ||
    actual.operation.batchId !== expected.operation.batchId ||
    actual.operation.operationId !== expected.operation.operationId ||
    wire.leaf_id !== expected.leafId
  ) {
    throw new IncompatibleKernelThroughputAnalysisError(
      [`identity: describes ${actualIdentity}, asked for ${expectedIdentity}`],
      KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
    );
  }
  const issues: string[] = [];
  const distinctFields = new Set(wire.input_fields);
  if (distinctFields.size !== wire.input_fields.length) {
    issues.push('input_fields: field names must be unique');
  }
  if (wire.input_fields.length !== wire.grid_axes.length) {
    issues.push(
      `grid_axes: expected ${wire.input_fields.length} axes, got ${wire.grid_axes.length}`,
    );
  }
  const expectedPoints = wire.grid_axes.reduce((count, axis) => count * axis.length, 1);
  if (!Number.isSafeInteger(expectedPoints)) {
    issues.push('grid_axes: Cartesian point count exceeds the safe integer range');
  } else if (wire.points.length !== expectedPoints) {
    issues.push(`points: expected ${expectedPoints} grid points, got ${wire.points.length}`);
  } else if (wire.input_fields.length === wire.grid_axes.length) {
    wire.points.forEach((point, pointIndex) => {
      const keys = Object.keys(point.input);
      const missing = wire.input_fields.filter((field) => !(field in point.input));
      const extra = keys.filter((field) => !distinctFields.has(field));
      if (missing.length > 0 || extra.length > 0) {
        issues.push(
          `points.${pointIndex}.input: expected exactly [${wire.input_fields.join(', ')}]${missing.length > 0 ? `; missing [${missing.join(', ')}]` : ''}${extra.length > 0 ? `; extra [${extra.join(', ')}]` : ''}`,
        );
        return;
      }
      let coordinateIndex = pointIndex;
      for (let axisIndex = wire.grid_axes.length - 1; axisIndex >= 0; axisIndex -= 1) {
        const axis = wire.grid_axes[axisIndex];
        const field = wire.input_fields[axisIndex];
        const expectedCoordinate = axis[coordinateIndex % axis.length];
        coordinateIndex = Math.floor(coordinateIndex / axis.length);
        if (point.input[field] !== expectedCoordinate) {
          issues.push(
            `points.${pointIndex}.input.${field}: expected row-major grid coordinate ${expectedCoordinate}, got ${point.input[field]}`,
          );
        }
      }
    });
  }
  if (issues.length > 0) {
    throw new IncompatibleKernelThroughputAnalysisError(
      issues,
      KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
    );
  }

  return Object.freeze({
    worker: Object.freeze(actual.worker),
    operation: Object.freeze(actual.operation),
    schemaVersion: KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
    leafId: wire.leaf_id,
    slot: Object.freeze({
      name: wire.slot.name,
      kind: wire.slot.kind,
      kernelConfig: Object.freeze(wire.slot.kernel_config) as Readonly<Record<string, JsonValue>>,
      backend: wire.slot.backend,
    }),
    exactInput: wire.exact_input,
    describeConfig: Object.freeze(wire.describe_config) as Readonly<Record<string, JsonValue>>,
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

export function parsePredictionKernelThroughputAnalysis(
  input: unknown,
  expected: PredictionKernelThroughputAnalysisRef,
): PredictionKernelThroughputAnalysis {
  const parsed = predictionWireSchema.safeParse(input);
  if (!parsed.success) {
    throw new IncompatibleKernelThroughputAnalysisError(
      parsed.error.issues.map(formatIssue),
      receivedVersion(input),
    );
  }
  const wire = parsed.data;
  const actual = `${wire.identity.prediction_id}/${asId(wire.identity.case_id)}/${asId(wire.identity.operation_id)}/leaf:${wire.leaf_id}`;
  const wanted = `${expected.result.id}/${expected.caseId}/${expected.operationId}/leaf:${expected.leafId}`;
  if (
    wire.identity.prediction_id !== expected.result.id ||
    asId(wire.identity.case_id) !== expected.caseId ||
    asId(wire.identity.operation_id) !== expected.operationId ||
    wire.leaf_id !== expected.leafId
  ) {
    throw new IncompatibleKernelThroughputAnalysisError(
      [`identity: describes ${actual}, asked for ${wanted}`],
      KERNEL_THROUGHPUT_ANALYSIS_SCHEMA_VERSION,
    );
  }
  const workerLike = {
    ...wire,
    identity: {
      pool_tag: 'prediction',
      worker_id: 0,
      iter_id: wire.identity.case_id,
      batch_id: 0,
      operation_id: wire.identity.operation_id,
      section: wire.identity.section,
      layer: wire.identity.layer,
    },
  };
  const common = parseKernelThroughputAnalysis(workerLike, {
    worker: { poolTag: 'prediction', workerId: '0' },
    operation: { iterId: expected.caseId, batchId: '0', operationId: expected.operationId },
    leafId: expected.leafId,
  });
  const { worker: _worker, operation: _operation, ...data } = common;
  return Object.freeze({
    ...data,
    predictionId: expected.result.id,
    caseId: expected.caseId,
    operationId: expected.operationId,
  });
}
