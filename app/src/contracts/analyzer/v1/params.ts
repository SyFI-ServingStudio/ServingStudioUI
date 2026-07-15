import { z, ZodError, type ZodIssue } from 'zod';

const finiteNumber = z.number().finite();
const positiveSafeInteger = z.number().int().positive().safe();
const nonBlankString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });
const scalar = z.union([z.string(), finiteNumber, z.boolean()]);

/** Arch and worker selectors are tagged, open scalar maps in the simulator.
 * Keeping their extra fields lets the topology adapter project every value the
 * current domain can represent without importing provider-specific schemas. */
export const analyzerV1ArchParamsSchema = z
  .object({
    type: nonBlankString,
    model_config: nonBlankString,
    fp8: z.boolean(),
  })
  .catchall(scalar);

export const analyzerV1WorkerParamsSchema = z
  .object({
    type: nonBlankString,
    attn_gpu_memory_gb: finiteNumber.positive().optional(),
    gpu_time_multiplier: finiteNumber.positive().optional(),
    max_batch_tokens: positiveSafeInteger.optional(),
  })
  .catchall(scalar);

export const analyzerV1GroupParamsSchema = z
  .object({
    gpu: nonBlankString,
    replicas: positiveSafeInteger,
    arch: analyzerV1ArchParamsSchema,
    worker: analyzerV1WorkerParamsSchema,
  })
  .strict();

export const analyzerV1PoolParamsSchema = z
  .object({
    placement: z.enum(['least-queued', 'round-robin']),
    groups: z.array(analyzerV1GroupParamsSchema).min(1),
  })
  .strict();

const unifiedParamsSchema = z
  .object({
    deployment: z.literal('unified'),
    pools: z.object({ main: analyzerV1PoolParamsSchema }).strict(),
  })
  // Workload, IO, backend overrides and start_ts are not topology inputs. They
  // remain opaque here instead of coupling this bounded adapter to all of L7.
  .passthrough();

const pdParamsSchema = z
  .object({
    deployment: z.literal('pd'),
    pools: z
      .object({
        prefill: analyzerV1PoolParamsSchema,
        decode: analyzerV1PoolParamsSchema,
      })
      .strict(),
  })
  .passthrough();

const afdParamsSchema = z
  .object({
    deployment: z.literal('afd'),
    pools: z
      .object({
        attn: analyzerV1PoolParamsSchema,
        ffn: analyzerV1PoolParamsSchema,
      })
      .strict(),
  })
  .passthrough();

/** Current launcher-expanded params contract, discriminated by deployment. */
export const analyzerV1ParamsSchema = z.discriminatedUnion('deployment', [
  unifiedParamsSchema,
  pdParamsSchema,
  afdParamsSchema,
]);

export type AnalyzerV1Params = z.infer<typeof analyzerV1ParamsSchema>;
export type AnalyzerV1GroupParams = z.infer<typeof analyzerV1GroupParamsSchema>;
export type AnalyzerV1ArchParams = z.infer<typeof analyzerV1ArchParamsSchema>;
export type AnalyzerV1WorkerParams = z.infer<typeof analyzerV1WorkerParamsSchema>;

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1ParamsError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 params:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1ParamsError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1Params(input: unknown): AnalyzerV1Params {
  try {
    return analyzerV1ParamsSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1ParamsError(error);
    throw error;
  }
}
