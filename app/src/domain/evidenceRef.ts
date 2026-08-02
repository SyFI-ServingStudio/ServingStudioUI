import { z } from 'zod';

import {
  aggregateAnalyzerSelectionV2Schema,
  analyzerSelectionV2Schema,
  kernelMeasurementAnalyzerSelectionV2Schema,
  kernelProfileAnalyzerSelectionV2Schema,
  predictionAnalyzerSelectionV2Schema,
  runAnalyzerSelectionV2Schema,
  type AnalyzerSelectionV2,
} from './analyzerSelection';

export const aggregateEvidenceRefV2Schema = aggregateAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const runEvidenceRefV2Schema = runAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const predictionEvidenceRefV2Schema = predictionAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const kernelProfileEvidenceRefV2Schema = kernelProfileAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const kernelMeasurementEvidenceRefV2Schema = kernelMeasurementAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const evidenceRefV2Schema = z.discriminatedUnion('kind', [
  aggregateEvidenceRefV2Schema,
  runEvidenceRefV2Schema,
  predictionEvidenceRefV2Schema,
  kernelProfileEvidenceRefV2Schema,
  kernelMeasurementEvidenceRefV2Schema,
]);

export type AggregateEvidenceRefV2 = z.infer<typeof aggregateEvidenceRefV2Schema>;
export type RunEvidenceRefV2 = z.infer<typeof runEvidenceRefV2Schema>;
export type PredictionEvidenceRefV2 = z.infer<typeof predictionEvidenceRefV2Schema>;
export type KernelProfileEvidenceRefV2 = z.infer<typeof kernelProfileEvidenceRefV2Schema>;
export type KernelMeasurementEvidenceRefV2 = z.infer<
  typeof kernelMeasurementEvidenceRefV2Schema
>;
export type EvidenceRefV2 = z.infer<typeof evidenceRefV2Schema>;

/** Evidence references are transport envelopes; the retained UI selection is
 * their protocol-free payload. Keep this conversion at the domain boundary so
 * strict selection schemas never receive transport metadata. */
export function analyzerSelectionFromEvidenceRef(reference: EvidenceRefV2): AnalyzerSelectionV2 {
  const { protocol: _protocol, ...selection } = reference;
  return analyzerSelectionV2Schema.parse(selection);
}
