import { z } from 'zod';

import { analyzerSelectionV2Schema } from './analyzerSelection';
import { evidenceRefV2Schema } from './evidenceRef';

export const citationDictionaryEntryV2Schema = z
  .object({
    token: z
      .string()
      .min(5)
      .max(160)
      .regex(/^(?:exp|run)\.[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/),
    displayLabel: z.string().min(1).max(240),
    target: evidenceRefV2Schema,
  })
  .strict();

export const citationDictionarySnapshotV2Schema = z
  .object({
    protocol: z.literal('vibesim.citation-dictionary/v2'),
    identity: z.string().min(1).max(160),
    document: z.string().min(1).max(64_000),
    entries: z.array(citationDictionaryEntryV2Schema).max(2_000),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const tokens = snapshot.entries.map((entry) => entry.token);
    if (new Set(tokens).size !== tokens.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'citation tokens must be unique' });
    }
  });

export const analyzerTurnContextV2Schema = z
  .object({
    protocol: z.literal('vibesim.conversation-context/v2'),
    selection: analyzerSelectionV2Schema.nullable(),
    citationDictionary: citationDictionarySnapshotV2Schema,
  })
  .strict();

export const frozenCitationV2Schema = z
  .object({
    protocol: z.literal('vibesim.citation/v2'),
    token: z.string(),
    sourceStart: z.number().int().nonnegative(),
    sourceEnd: z.number().int().nonnegative(),
    displayLabel: z.string(),
    target: evidenceRefV2Schema,
  })
  .strict()
  .refine((citation) => citation.sourceEnd > citation.sourceStart, {
    message: 'citation source range must be non-empty',
  });

export type CitationDictionaryEntryV2 = z.infer<typeof citationDictionaryEntryV2Schema>;
export type CitationDictionarySnapshotV2 = z.infer<typeof citationDictionarySnapshotV2Schema>;
export type AnalyzerTurnContextV2 = z.infer<typeof analyzerTurnContextV2Schema>;
export type FrozenCitationV2 = z.infer<typeof frozenCitationV2Schema>;
