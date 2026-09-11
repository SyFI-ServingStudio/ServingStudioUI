import { z } from 'zod';

import type {
  JsonValue,
  PredictionCasePage,
  PredictionCostTreeDetail,
  PredictionDescriptor,
  PredictionCasesRef,
  PredictionCostTreeRef,
} from '../ref';
import { decodeRawExactCostTreeBody, exactCostTreeBodySchema } from './workerCostTree';
import { analyzerV1CapabilitySchema } from './capability';

export const PREDICTION_SCHEMA_VERSION = 1;

export class IncompatiblePredictionError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(
      `prediction artifact is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatiblePredictionError';
  }
}

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
    schema_version: z.literal(PREDICTION_SCHEMA_VERSION),
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
        cases: analyzerV1CapabilitySchema,
        'kernel-input-distribution': analyzerV1CapabilitySchema.nullable(),
        'scoped-optimality': analyzerV1CapabilitySchema.nullable().optional(),
      })
      .strict(),
  })
  .strict();

const casesSchema = z
  .object({
    schema_version: z.literal(PREDICTION_SCHEMA_VERSION),
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
    if (page.range.returned > 0 && page.range.offset + page.range.returned > page.range.total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['range'],
        message: 'prediction case page exceeds total',
      });
    }
  });

const costTreeSchema = exactCostTreeBodySchema
  .extend({
    schema_version: z.literal(PREDICTION_SCHEMA_VERSION),
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

function receivedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || !('schema_version' in input)) return undefined;
  const value = input.schema_version;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new IncompatiblePredictionError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      receivedVersion(input),
    );
  }
  return parsed.data;
}

const asId = (value: string | number): string => String(value);

export function parsePredictionDescriptor(
  input: unknown,
  expectedPredictionId: string,
): PredictionDescriptor {
  const value = parse(descriptorSchema, input);
  if (value.prediction_id !== expectedPredictionId) {
    throw new IncompatiblePredictionError(
      [`identity: describes ${value.prediction_id}, asked for ${expectedPredictionId}`],
      PREDICTION_SCHEMA_VERSION,
    );
  }
  return Object.freeze({
    predictionId: value.prediction_id,
    displayName: value.display_name,
    selector: value.selector,
    archType: value.arch.type,
    gpu: Object.freeze({ name: value.gpu.name, count: value.gpu.count }),
    caseCount: value.case_count,
    lifecycle: Object.freeze(value.lifecycle),
    kernelInputDistributionAvailable: value.resources['kernel-input-distribution'] !== null,
    scopedOptimalityAvailable: value.resources['scoped-optimality'] != null,
  });
}

export function parsePredictionCases(
  input: unknown,
  expected: PredictionCasesRef | string,
): PredictionCasePage {
  const value = parse(casesSchema, input);
  const expectedPredictionId = typeof expected === 'string' ? expected : expected.result.id;
  const issues: string[] = [];
  if (value.prediction_id !== expectedPredictionId) {
    issues.push(`identity: describes ${value.prediction_id}, asked for ${expectedPredictionId}`);
  }
  if (
    typeof expected !== 'string' &&
    (value.range.offset !== expected.offset || value.range.limit !== expected.limit)
  ) {
    issues.push(
      `range: describes offset ${value.range.offset}, limit ${value.range.limit}; asked for offset ${expected.offset}, limit ${expected.limit}`,
    );
  }
  value.cases.forEach((predictionCase, index) => {
    const expectedCaseId = String(value.range.offset + index);
    if (String(predictionCase.case_id) !== expectedCaseId) {
      issues.push(`cases.${index}.case_id: expected contiguous id ${expectedCaseId}`);
    }
    const operationIds = predictionCase.operations.map((operation) =>
      String(operation.operation_id),
    );
    operationIds.forEach((operationId, operationIndex) => {
      if (operationId !== String(operationIndex)) {
        issues.push(
          `cases.${index}.operations.${operationIndex}.operation_id: expected contiguous id ${operationIndex}`,
        );
      }
    });
  });
  if (issues.length > 0) {
    throw new IncompatiblePredictionError(issues, PREDICTION_SCHEMA_VERSION);
  }
  return Object.freeze({
    predictionId: value.prediction_id,
    offset: value.range.offset,
    total: value.range.total,
    cases: Object.freeze(
      value.cases.map((predictionCase) =>
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

export function parsePredictionCostTree(
  input: unknown,
  expected: PredictionCostTreeRef,
): PredictionCostTreeDetail {
  const value = parse(costTreeSchema, input);
  const actual = {
    predictionId: value.identity.prediction_id,
    caseId: asId(value.identity.case_id),
    operationId: asId(value.identity.operation_id),
  };
  if (
    actual.predictionId !== expected.result.id ||
    actual.caseId !== expected.caseId ||
    actual.operationId !== expected.operationId
  ) {
    throw new IncompatiblePredictionError(
      [
        `identity: describes ${actual.predictionId}/${actual.caseId}/${actual.operationId}, asked for ${expected.result.id}/${expected.caseId}/${expected.operationId}`,
      ],
      PREDICTION_SCHEMA_VERSION,
    );
  }
  try {
    return Object.freeze({
      ...decodeRawExactCostTreeBody(value),
      ...actual,
      section: value.identity.section,
      layer: value.identity.layer,
    });
  } catch (error) {
    throw new IncompatiblePredictionError(
      [`tree: ${error instanceof Error ? error.message : String(error)}`],
      PREDICTION_SCHEMA_VERSION,
    );
  }
}

export const parseAnalyzerV1PredictionDescriptor = parsePredictionDescriptor;
export const parseAnalyzerV1PredictionCases = parsePredictionCases;
export function parseAnalyzerV1PredictionCostTree(
  input: unknown,
  expected: {
    readonly predictionId: string;
    readonly caseId: string;
    readonly operationId: string;
  },
): PredictionCostTreeDetail {
  return parsePredictionCostTree(input, {
    kind: 'predictionCostTree',
    result: { kind: 'prediction', id: expected.predictionId, workspace: 'w_compat' },
    caseId: expected.caseId,
    operationId: expected.operationId,
  });
}
