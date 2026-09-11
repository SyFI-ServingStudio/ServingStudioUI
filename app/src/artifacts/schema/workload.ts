import { z } from 'zod';

import type { RunWorkload } from '../ref';

export const RUN_WORKLOAD_SCHEMA_VERSION = 1;
const MAX_POINTS = 72;
const finiteNonNegative = z.number().finite().nonnegative();
const boundedSeries = z.array(finiteNonNegative).max(MAX_POINTS);
const sourcePath = z
  .string()
  .min(1)
  .refine((path) => {
    if (path.includes('\\') || path.startsWith('/') || path.endsWith('/')) return false;
    return path
      .split('/')
      .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }, 'must be a normalized repository-relative path')
  .refine((path) => {
    const directories = path.split('/').slice(0, -1);
    return directories.includes('trace') || (directories.includes('logs') && path.endsWith('.csv'));
  }, 'must be inside a trace directory or a CSV under logs');

export class IncompatibleRunWorkloadError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`workload payload is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'IncompatibleRunWorkloadError';
  }
}

const schema = z
  .object({
    schema_version: z.number(),
    scope: z.literal('configured_trace'),
    source_paths: z.array(sourcePath).min(1).max(64),
    request_count: z.number().int().nonnegative().safe(),
    average_input_tokens: finiteNonNegative,
    average_output_tokens: finiteNonNegative,
    arrival_basis: z.enum(['effective_open_loop', 'effective_trace_timed', 'source_trace']),
    request_rate: finiteNonNegative,
    token_lengths: boundedSeries,
    input_density: boundedSeries,
    output_density: boundedSeries,
    arrival_seconds: boundedSeries,
    arrivals: boundedSeries,
    arrival_trend: boundedSeries,
    peak_to_mean: finiteNonNegative,
  })
  .strict();

export function parseRunWorkload(body: unknown): RunWorkload {
  const received = (body as { schema_version?: unknown } | null)?.schema_version;
  if (received !== RUN_WORKLOAD_SCHEMA_VERSION) {
    throw new IncompatibleRunWorkloadError(
      [`schema_version ${String(received)} is not ${RUN_WORKLOAD_SCHEMA_VERSION}`],
      typeof received === 'number' ? received : undefined,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRunWorkloadError(
      parsed.error.issues.map(
        (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
      ),
      received,
    );
  }
  const value = parsed.data;
  const issues: string[] = [];
  if (
    value.token_lengths.length !== value.input_density.length ||
    value.token_lengths.length !== value.output_density.length
  ) {
    issues.push('token_lengths, input_density and output_density must have equal lengths');
  }
  if (
    value.arrival_seconds.length !== value.arrivals.length ||
    value.arrival_seconds.length !== value.arrival_trend.length
  ) {
    issues.push('arrival_seconds, arrivals and arrival_trend must have equal lengths');
  }
  if (issues.length > 0) throw new IncompatibleRunWorkloadError(issues, received);
  return {
    sourcePaths: value.source_paths,
    requestCount: value.request_count,
    averageInputTokens: value.average_input_tokens,
    averageOutputTokens: value.average_output_tokens,
    arrivalBasis: value.arrival_basis,
    requestRate: value.request_rate,
    tokenLengths: value.token_lengths,
    inputDensity: value.input_density,
    outputDensity: value.output_density,
    arrivalSeconds: value.arrival_seconds,
    arrivals: value.arrivals,
    arrivalTrend: value.arrival_trend,
    peakToMean: value.peak_to_mean,
  };
}
