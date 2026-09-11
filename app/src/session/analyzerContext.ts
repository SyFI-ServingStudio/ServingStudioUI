import { z } from 'zod';

const nonEmptyString = z.string().min(1);
export const analyzerCoordinateValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).readonly(),
]);

export const aggregateAnalyzerSelectionV2Schema = z
  .object({
    kind: z.literal('aggregate'),
    workspaceId: nonEmptyString,
    experimentId: nonEmptyString,
    panelId: nonEmptyString.optional(),
    metricKey: nonEmptyString.optional(),
    statistic: z.enum(['mean', 'p99']).optional(),
    runId: nonEmptyString.optional(),
    coordinates: z.record(analyzerCoordinateValueSchema).optional(),
  })
  .strict();

export type AggregateAnalyzerSelectionV2 = z.infer<typeof aggregateAnalyzerSelectionV2Schema>;

const operationRefSchema = z
  .object({
    iterId: nonEmptyString,
    batchId: nonEmptyString,
    operationId: nonEmptyString,
  })
  .strict();

/** Literal, serializable projection of the frozen run-detail evidence fields.
 * Keep nulls: the inquiry payload must show what is unselected, not silently
 * erase fields and make the agent infer their state. */
export const runAnalyzerSelectionV2Schema = z
  .object({
    kind: z.literal('run'),
    workspaceId: nonEmptyString,
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

export type RunAnalyzerSelectionV2 = z.infer<typeof runAnalyzerSelectionV2Schema>;

export const predictionAnalyzerSelectionV2Schema = z
  .object({
    kind: z.literal('prediction'),
    workspaceId: nonEmptyString,
    predictionId: nonEmptyString,
    panelId: nonEmptyString.nullable(),
    caseId: nonEmptyString.nullable(),
    operationId: nonEmptyString.nullable(),
    leafId: z.number().int().nonnegative().nullable(),
    parallelId: z.number().int().nonnegative().nullable(),
    optimalityMode: z.enum(['unlocked', 'batch_locked']),
  })
  .strict();

export type PredictionAnalyzerSelectionV2 = z.infer<typeof predictionAnalyzerSelectionV2Schema>;

export const kernelProfileAnalyzerSelectionV2Schema = z
  .object({
    kind: z.literal('kernel_profile'),
    workspaceId: nonEmptyString,
    profileId: nonEmptyString,
    panelId: nonEmptyString.nullable(),
    metricKey: nonEmptyString.nullable(),
  })
  .strict();

export type KernelProfileAnalyzerSelectionV2 = z.infer<
  typeof kernelProfileAnalyzerSelectionV2Schema
>;

export const kernelMeasurementAnalyzerSelectionV2Schema = z
  .object({
    kind: z.literal('kernel_measurement'),
    workspaceId: nonEmptyString,
    measurementId: nonEmptyString,
    panelId: nonEmptyString.nullable(),
    metricKey: nonEmptyString.nullable(),
    plotName: nonEmptyString.nullable(),
  })
  .strict();

export type KernelMeasurementAnalyzerSelectionV2 = z.infer<
  typeof kernelMeasurementAnalyzerSelectionV2Schema
>;

export const analyzerSelectionV2Schema = z.discriminatedUnion('kind', [
  aggregateAnalyzerSelectionV2Schema,
  runAnalyzerSelectionV2Schema,
  predictionAnalyzerSelectionV2Schema,
  kernelProfileAnalyzerSelectionV2Schema,
  kernelMeasurementAnalyzerSelectionV2Schema,
]);

export type AnalyzerSelectionV2 = z.infer<typeof analyzerSelectionV2Schema>;

export const inquiryContextV2Schema = z
  .object({
    protocol: z.literal('vibesim.inquiry-context/v2'),
    inquiryId: nonEmptyString,
    phaseId: nonEmptyString,
    selection: analyzerSelectionV2Schema,
  })
  .strict();

export type InquiryContextV2 = z.infer<typeof inquiryContextV2Schema>;

export const analyzerSelectionChangeV2Schema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    type: z.literal('selection-change'),
    revision: z.number().int().positive(),
    selection: analyzerSelectionV2Schema,
    context: inquiryContextV2Schema.optional(),
  })
  .strict();

export type AnalyzerSelectionChangeV2 = z.infer<typeof analyzerSelectionChangeV2Schema>;
