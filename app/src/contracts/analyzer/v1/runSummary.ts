import { z, ZodError, type ZodIssue } from 'zod';

import type { RunSummaryArtifact } from '../../../domain/artifacts';

const finiteNonNegative = z.number().finite().nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();

/** Current simulator summary.json contract. It has no schema_version, so every
 * known field is named explicitly and protocol drift fails visibly. */
export const analyzerV1RunSummarySchema = z
  .object({
    cause: z.string().trim().min(1),
    completed_req_s: finiteNonNegative,
    decode_tok_s: finiteNonNegative,
    decode_tokens: nonNegativeInteger,
    num_gpus: z.number().int().positive(),
    prefill_tok_s: finiteNonNegative,
    prefill_tokens: nonNegativeInteger,
    realtime_x: finiteNonNegative,
    requests_finished: nonNegativeInteger,
    requests_total: nonNegativeInteger,
    sim_ms: finiteNonNegative,
    total_tok_s: finiteNonNegative,
    total_tok_s_per_gpu: finiteNonNegative,
    total_tokens: nonNegativeInteger,
    wall_s: finiteNonNegative,
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.requests_finished > summary.requests_total) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requests_finished'],
        message: 'must not exceed requests_total',
      });
    }
    if (summary.prefill_tokens + summary.decode_tokens !== summary.total_tokens) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['total_tokens'],
        message: 'must equal prefill_tokens + decode_tokens',
      });
    }
  });

export interface AnalyzerV1RunSummary extends RunSummaryArtifact {
  cause: string;
  completedReqS: number;
  decodeTokS: number;
  decodeTokens: number;
  prefillTokS: number;
  prefillTokens: number;
  realtimeX: number;
  simMs: number;
  totalTokSPerGpu: number;
  totalTokens: number;
  wallS: number;
}

type WireRunSummary = z.infer<typeof analyzerV1RunSummarySchema>;

function toRunSummary(wire: WireRunSummary): AnalyzerV1RunSummary {
  return {
    totalTokS: wire.total_tok_s,
    numGpus: wire.num_gpus,
    requestsFinished: wire.requests_finished,
    requestsTotal: wire.requests_total,
    cause: wire.cause,
    completedReqS: wire.completed_req_s,
    decodeTokS: wire.decode_tok_s,
    decodeTokens: wire.decode_tokens,
    prefillTokS: wire.prefill_tok_s,
    prefillTokens: wire.prefill_tokens,
    realtimeX: wire.realtime_x,
    simMs: wire.sim_ms,
    totalTokSPerGpu: wire.total_tok_s_per_gpu,
    totalTokens: wire.total_tokens,
    wallS: wire.wall_s,
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1RunSummaryError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 run summary:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunSummaryError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1RunSummary(input: unknown): AnalyzerV1RunSummary {
  try {
    return toRunSummary(analyzerV1RunSummarySchema.parse(input));
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1RunSummaryError(error);
    throw error;
  }
}
