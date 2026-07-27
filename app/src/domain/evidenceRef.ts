import { z } from 'zod';

import {
  aggregateAnalyzerSelectionV1Schema,
  runAnalyzerSelectionV1Schema,
} from './analyzerSelection';

export const aggregateEvidenceRefV1Schema = aggregateAnalyzerSelectionV1Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v1') })
  .strict();

export const runEvidenceRefV1Schema = runAnalyzerSelectionV1Schema
  .extend({ protocol: z.literal('vibesim.analyzer/v1') })
  .strict();

export const evidenceRefV1Schema = z.discriminatedUnion('kind', [
  aggregateEvidenceRefV1Schema,
  runEvidenceRefV1Schema,
]);

export type AggregateEvidenceRefV1 = z.infer<typeof aggregateEvidenceRefV1Schema>;
export type RunEvidenceRefV1 = z.infer<typeof runEvidenceRefV1Schema>;
export type EvidenceRefV1 = z.infer<typeof evidenceRefV1Schema>;
