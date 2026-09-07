import { z } from 'zod';

import type { JsonValue } from '../../../domain/cost-tree';
import type {
  PredictionCasePage,
  PredictionCostTreeDetail,
  PredictionDescriptor,
} from '../../../domain/prediction';
import { decodeExactCostTreeBody, exactCostTreeBodySchema } from './workerOperation';

const nonNegativeInteger = z.number().int().nonnegative().safe();
const decimalId = z.union([nonNegativeInteger, z.string().regex(/^(0|[1-9]\d*)$/)]);
const predictionId = z.string().regex(/^p_[a-z0-9_]{1,64}$/);
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValue),
    z.record(jsonValue),
  ]),
);

const descriptorSchema = z
  .object({
    schema_version: z.literal(1),
    prediction_id: predictionId,
    kind: z.literal('timing_predict'),
    display_name: z.string().min(1),
    selector: z.enum(['iter', 'speculative_iter', 'attn', 'ffn']),
    arch: z.object({ type: z.string().min(1) }).strict(),
    gpu: z.object({ name: z.string().min(1), count: nonNegativeInteger.min(1) }).strict(),
    case_count: nonNegativeInteger,
    lifecycle: z
      .object({
        prediction: z.enum(['pending', 'complete']),
        analysis: z.enum(['not_started', 'complete']),
      })
      .strict(),
    resources: z
      .object({
        cases_href: z.string().min(1),
        kernel_input_distribution_href: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

const casesSchema = z
  .object({
    schema_version: z.literal(1),
    prediction_id: predictionId,
    range: z
      .object({
        offset: nonNegativeInteger,
        limit: nonNegativeInteger.min(1).max(128),
        returned: nonNegativeInteger.max(128),
        total: nonNegativeInteger,
      })
      .strict(),
    cases: z.array(
      z
        .object({
          case_id: decimalId,
          input: jsonValue,
          total_time_ms: z.number().finite().nonnegative(),
          operations: z.array(
            z
              .object({
                operation_id: decimalId,
                section: z.string().min(1),
                layer: z.number().int().safe(),
                time_ms: z.number().finite().nonnegative(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.range.returned !== page.cases.length || page.range.returned > page.range.limit) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range', 'returned'],
        message: 'prediction case returned count does not match its page',
      });
    }
    if (page.range.offset + page.range.returned > page.range.total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range'],
        message: 'prediction case page exceeds total',
      });
    }
  });

const costTreeSchema = exactCostTreeBodySchema
  .extend({
    schema_version: z.literal(1),
    identity: z
      .object({
        prediction_id: predictionId,
        case_id: decimalId,
        operation_id: decimalId,
        section: z.string().min(1),
        layer: z.number().int().safe(),
      })
      .strict(),
  })
  .strict();

const asId = (value: string | number): string => String(value);

export function parseAnalyzerV1PredictionDescriptor(
  input: unknown,
  expectedPredictionId: string,
): PredictionDescriptor {
  const descriptor = descriptorSchema.parse(input);
  if (descriptor.prediction_id !== expectedPredictionId) {
    throw new Error('Prediction descriptor identity does not match the request.');
  }
  return Object.freeze({
    predictionId: descriptor.prediction_id,
    displayName: descriptor.display_name,
    selector: descriptor.selector,
    archType: descriptor.arch.type,
    gpu: Object.freeze({ name: descriptor.gpu.name, count: descriptor.gpu.count }),
    caseCount: descriptor.case_count,
    lifecycle: Object.freeze(descriptor.lifecycle),
    kernelInputDistributionAvailable: descriptor.resources.kernel_input_distribution_href !== null,
  });
}

export function parseAnalyzerV1PredictionCases(
  input: unknown,
  expectedPredictionId: string,
): PredictionCasePage {
  const page = casesSchema.parse(input);
  if (page.prediction_id !== expectedPredictionId) {
    throw new Error('Prediction case page identity does not match the request.');
  }
  return Object.freeze({
    predictionId: page.prediction_id,
    offset: page.range.offset,
    total: page.range.total,
    cases: Object.freeze(
      page.cases.map((predictionCase) =>
        Object.freeze({
          caseId: asId(predictionCase.case_id),
          input: predictionCase.input,
          totalTimeMs: predictionCase.total_time_ms,
          operations: Object.freeze(
            predictionCase.operations.map((operation) =>
              Object.freeze({
                operationId: asId(operation.operation_id),
                section: operation.section,
                layer: operation.layer,
                timeMs: operation.time_ms,
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

export function parseAnalyzerV1PredictionCostTree(
  input: unknown,
  expected: { predictionId: string; caseId: string; operationId: string },
): PredictionCostTreeDetail {
  const detail = costTreeSchema.parse(input);
  const identity = {
    predictionId: detail.identity.prediction_id,
    caseId: asId(detail.identity.case_id),
    operationId: asId(detail.identity.operation_id),
  };
  if (
    identity.predictionId !== expected.predictionId ||
    identity.caseId !== expected.caseId ||
    identity.operationId !== expected.operationId
  ) {
    throw new Error('Prediction CostTree identity does not match the request.');
  }
  return Object.freeze({
    ...decodeExactCostTreeBody(detail),
    ...identity,
    section: detail.identity.section,
    layer: detail.identity.layer,
  });
}
