/**
 * Frozen citations, read.
 *
 * The conversation backend freezes every inline-code citation into a turn event
 * as `vibesim.analyzer/v2` (`backend/analyzer_context.py`). Those bytes are
 * history: they were written when the turn ran and cannot be regenerated,
 * because regenerating them would mean re-running an agent against data that has
 * since changed. So this module reads v2 and always will.
 *
 * The schema belongs to the session boundary because stored events carry these
 * bytes. Translation into the current application address lives in `app/`.
 */
import { z } from 'zod';

import { sweepCoordinatesSchema } from '../location/types';

const nonEmptyString = z.string().min(1);

const operationRefSchema = z
  .object({
    iterId: nonEmptyString,
    batchId: nonEmptyString,
    operationId: nonEmptyString,
  })
  .strict();

/**
 * Frozen targets omit null selectors, while live dictionaries retain them.
 * Normalize absent nullable selectors on read without rewriting stored events.
 */
export const agentV1AggregateEvidenceRefSchema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    kind: z.literal('aggregate'),
    workspaceId: nonEmptyString,
    experimentId: nonEmptyString,
    panelId: nonEmptyString.optional(),
    metricKey: nonEmptyString.optional(),
    statistic: z.enum(['mean', 'p99']).optional(),
    runId: nonEmptyString.optional(),
    coordinates: sweepCoordinatesSchema.optional(),
  })
  .strict();

export const agentV1RunEvidenceRefSchema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    kind: z.literal('run'),
    workspaceId: nonEmptyString,
    runId: nonEmptyString,
    panelId: nonEmptyString.nullable().default(null),
    scope: z.enum(['cluster', 'pool', 'worker', 'kernel', 'parallel']),
    poolRole: nonEmptyString.nullable().default(null),
    workerKey: nonEmptyString.nullable().default(null),
    leafId: z.number().int().nonnegative().nullable().default(null),
    parId: z.number().int().nonnegative().nullable().default(null),
    cursorMs: z.number().finite().nonnegative().nullable().default(null),
    cursorNeedsSeek: z.boolean(),
    operation: operationRefSchema.nullable().default(null),
    workerAnalysisLevel: z.enum(['worker', 'iteration']),
  })
  .strict();

export const agentV1PredictionEvidenceRefSchema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    kind: z.literal('prediction'),
    workspaceId: nonEmptyString,
    predictionId: nonEmptyString,
    panelId: nonEmptyString.nullable().default(null),
    caseId: nonEmptyString.nullable().default(null),
    operationId: nonEmptyString.nullable().default(null),
    leafId: z.number().int().nonnegative().nullable().default(null),
    parallelId: z.number().int().nonnegative().nullable().default(null),
    optimalityMode: z.enum(['unlocked', 'batch_locked']),
  })
  .strict();

export const agentV1KernelProfileEvidenceRefSchema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    kind: z.literal('kernel_profile'),
    workspaceId: nonEmptyString,
    profileId: nonEmptyString,
    panelId: nonEmptyString.nullable().default(null),
    metricKey: nonEmptyString.nullable().default(null),
  })
  .strict();

export const agentV1KernelMeasurementEvidenceRefSchema = z
  .object({
    protocol: z.literal('vibesim.analyzer/v2'),
    kind: z.literal('kernel_measurement'),
    workspaceId: nonEmptyString,
    measurementId: nonEmptyString,
    panelId: nonEmptyString.nullable().default(null),
    metricKey: nonEmptyString.nullable().default(null),
    plotName: nonEmptyString.nullable().default(null),
  })
  .strict();

export const agentV1EvidenceRefSchema = z.discriminatedUnion('kind', [
  agentV1AggregateEvidenceRefSchema,
  agentV1RunEvidenceRefSchema,
  agentV1PredictionEvidenceRefSchema,
  agentV1KernelProfileEvidenceRefSchema,
  agentV1KernelMeasurementEvidenceRefSchema,
]);

export type AgentV1EvidenceRef = z.infer<typeof agentV1EvidenceRefSchema>;
