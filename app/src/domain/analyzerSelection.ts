import { z } from 'zod';

const nonEmptyString = z.string().min(1);
export const analyzerCoordinateValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])),
]);

export const aggregateAnalyzerSelectionV1Schema = z
  .object({
    kind: z.literal('aggregate'),
    experimentId: nonEmptyString,
    panelId: nonEmptyString.optional(),
    metricKey: nonEmptyString.optional(),
    statistic: z.enum(['mean', 'p99']).optional(),
    runId: nonEmptyString.optional(),
    coordinates: z.record(analyzerCoordinateValueSchema).optional(),
  })
  .strict();

export type AggregateAnalyzerSelectionV1 = z.infer<typeof aggregateAnalyzerSelectionV1Schema>;

const operationRefSchema = z
  .object({
    iterId: nonEmptyString,
    batchId: nonEmptyString,
    operationId: nonEmptyString,
  })
  .strict();

/** Literal, serializable projection of the run-detail evidence fields in VizState.
 * Keep nulls: the inquiry payload must show what is unselected, not silently
 * erase fields and make the agent infer their state. */
export const runAnalyzerSelectionV1Schema = z
  .object({
    kind: z.literal('run'),
    runId: nonEmptyString,
    panelId: nonEmptyString.nullable(),
    scope: z.enum(['cluster', 'pool', 'worker', 'kernel', 'parallel']),
    poolRole: nonEmptyString.nullable(),
    workerKey: nonEmptyString.nullable(),
    leafId: z.number().int().nonnegative().nullable(),
    parId: z.number().int().nonnegative().nullable(),
    cursorMs: z.number().finite().nonnegative().nullable(),
    cursorNeedsSeek: z.boolean(),
    operation: operationRefSchema.nullable(),
    workerAnalysisLevel: z.enum(['worker', 'iteration']),
  })
  .strict();

export type RunAnalyzerSelectionV1 = z.infer<typeof runAnalyzerSelectionV1Schema>;

export const analyzerSelectionV1Schema = z.discriminatedUnion('kind', [
  aggregateAnalyzerSelectionV1Schema,
  runAnalyzerSelectionV1Schema,
]);

export type AnalyzerSelectionV1 = z.infer<typeof analyzerSelectionV1Schema>;

export const inquiryContextV1Schema = z
  .object({
    protocol: z.literal('vibesim.inquiry-context/v1'),
    inquiryId: nonEmptyString,
    phaseId: nonEmptyString,
    selection: analyzerSelectionV1Schema,
  })
  .strict();

export type InquiryContextV1 = z.infer<typeof inquiryContextV1Schema>;

export const analyzerSelectionChangeV1Schema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v1'),
    type: z.literal('selection-change'),
    revision: z.number().int().positive(),
    selection: analyzerSelectionV1Schema,
    context: inquiryContextV1Schema.optional(),
  })
  .strict();

export type AnalyzerSelectionChangeV1 = z.infer<typeof analyzerSelectionChangeV1Schema>;
