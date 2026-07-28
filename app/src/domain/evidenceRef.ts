import { z } from 'zod';

import {
  aggregateAnalyzerSelectionV2Schema,
  runAnalyzerSelectionV2Schema,
} from './analyzerSelection';

export const aggregateEvidenceRefV2Schema = aggregateAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const runEvidenceRefV2Schema = runAnalyzerSelectionV2Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v2') })
  .strict();

export const evidenceRefV2Schema = z.discriminatedUnion('kind', [
  aggregateEvidenceRefV2Schema,
  runEvidenceRefV2Schema,
]);

export type AggregateEvidenceRefV2 = z.infer<typeof aggregateEvidenceRefV2Schema>;
export type RunEvidenceRefV2 = z.infer<typeof runEvidenceRefV2Schema>;
export type EvidenceRefV2 = z.infer<typeof evidenceRefV2Schema>;
