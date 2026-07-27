import { z } from 'zod';

import { analyzerSelectionV1Schema } from './analyzerSelection';
import { evidenceRefV1Schema } from './evidenceRef';

export const citationDictionaryEntryV1Schema = z
  .object({
    token: z
      .string()
      .min(5)
      .max(160)
      .regex(/^(?:exp|run)\.[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/),
    displayLabel: z.string().min(1).max(240),
    target: evidenceRefV1Schema,
  })
  .strict();

export const citationDictionarySnapshotV1Schema = z
  .object({
    protocol: z.literal('vibesim.citation-dictionary/v1'),
    identity: z.string().min(1).max(160),
    document: z.string().min(1).max(64_000),
    entries: z.array(citationDictionaryEntryV1Schema).max(2_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const tokens = snapshot.entries.map((entry) => entry.token);
    if (new Set(tokens).size !== tokens.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'citation tokens must be unique' });
    }
  });

export const analyzerTurnContextV1Schema = z
  .object({
    protocol: z.literal('vibesim.conversation-context/v1'),
    selection: analyzerSelectionV1Schema.nullable(),
    citationDictionary: citationDictionarySnapshotV1Schema,
  })
  .strict();

export const frozenCitationV1Schema = z
  .object({
    protocol: z.literal('vibesim.citation/v1'),
    token: z.string(),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().nonnegative(),
    displayLabel: z.string(),
    target: evidenceRefV1Schema,
  })
  .strict()
  .refine((citation) => citation.sourceEnd > citation.sourceStart, {
    message: 'citation source range must be non-empty',
  });

export type CitationDictionaryEntryV1 = z.infer<typeof citationDictionaryEntryV1Schema>;
export type CitationDictionarySnapshotV1 = z.infer<typeof citationDictionarySnapshotV1Schema>;
export type AnalyzerTurnContextV1 = z.infer<typeof analyzerTurnContextV1Schema>;
export type FrozenCitationV1 = z.infer<typeof frozenCitationV1Schema>;
