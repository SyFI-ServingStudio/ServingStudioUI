import { z, ZodError } from 'zod';

import type {
  JsonValue,
  ModelConfigResource,
  WorkloadOverviewResource,
} from '../../../domain/overviewResources';

const MAX_OVERVIEW_POINTS = 72;
const MAX_SOURCE_PATHS = 64;
const finiteNonNegative = z.number().finite().nonnegative();
const boundedSeries = z.array(finiteNonNegative).max(MAX_OVERVIEW_POINTS);
const repoSourcePath = z
  .string()
  .min(1)
  .refine((path) => {
    if (path.includes('\\') || path.startsWith('/') || path.endsWith('/')) return false;
    const segments = path.split('/');
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
  }, 'must be a normalized repository-relative path');

const modelSourcePath = repoSourcePath.refine(
  (path) => path.startsWith('model/config/'),
  'must be below model/config',
);
const traceSourcePath = repoSourcePath.refine((path) => {
  const directories = path.split('/').slice(0, -1);
  return directories.includes('trace') || (directories.includes('logs') && path.endsWith('.csv'));
}, 'must be inside a trace directory or a CSV under logs');

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const modelResourceV1Schema = z
  .object({
    schema_version: z.literal(1),
    source_path: modelSourcePath,
    config: z.record(jsonValueSchema),
  })
  .strict();

const modelResourceV2Schema = z
  .object({
    schema_version: z.literal(2),
    source_path: modelSourcePath,
    config: z.record(jsonValueSchema),
    parameter_counts: z
      .object({
        total: z.number().int().nonnegative().safe(),
        active: z.number().int().nonnegative().safe(),
        active_layers: z.number().int().nonnegative().safe(),
        active_definition: z.literal('with_embed_head'),
      })
      .strict()
      .nullable(),
  })
  .strict();

const modelResourceSchema = z.discriminatedUnion('schema_version', [
  modelResourceV1Schema,
  modelResourceV2Schema,
]);

const workloadResourceSchema = z
  .object({
    schema_version: z.literal(1),
    scope: z.literal('configured_trace'),
    source_paths: z.array(traceSourcePath).min(1).max(MAX_SOURCE_PATHS),
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
  .strict()
  .superRefine((resource, context) => {
    if (
      resource.token_lengths.length !== resource.input_density.length ||
      resource.token_lengths.length !== resource.output_density.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token_lengths'],
        message: 'token length and density arrays must have equal lengths',
      });
    }
    if (
      resource.arrival_seconds.length !== resource.arrivals.length ||
      resource.arrival_seconds.length !== resource.arrival_trend.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['arrival_seconds'],
        message: 'arrival arrays must have equal lengths',
      });
    }
  });

export class AnalyzerV1OverviewResourceError extends Error {
  constructor(resource: 'model' | 'workload', error: ZodError) {
    super(
      `Invalid analyzer-v1 ${resource} resource:\n${error.issues
        .map((issue) => `- ${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'AnalyzerV1OverviewResourceError';
  }
}

export function parseAnalyzerV1ModelResource(input: unknown): ModelConfigResource {
  try {
    const resource = modelResourceSchema.parse(input);
    return {
      schemaVersion: resource.schema_version,
      sourcePath: resource.source_path,
      config: resource.config,
      parameterCounts:
        resource.schema_version === 1 || resource.parameter_counts === null
          ? null
          : {
              total: resource.parameter_counts.total,
              active: resource.parameter_counts.active,
              activeLayers: resource.parameter_counts.active_layers,
              activeDefinition: resource.parameter_counts.active_definition,
            },
    };
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1OverviewResourceError('model', error);
    throw error;
  }
}

export function parseAnalyzerV1WorkloadResource(input: unknown): WorkloadOverviewResource {
  try {
    const resource = workloadResourceSchema.parse(input);
    return {
      schemaVersion: 1,
      scope: resource.scope,
      sourcePaths: resource.source_paths,
      requestCount: resource.request_count,
      averageInputTokens: resource.average_input_tokens,
      averageOutputTokens: resource.average_output_tokens,
      arrivalBasis: resource.arrival_basis,
      requestRate: resource.request_rate,
      tokenLengths: resource.token_lengths,
      inputDensity: resource.input_density,
      outputDensity: resource.output_density,
      arrivalSeconds: resource.arrival_seconds,
      arrivals: resource.arrivals,
      arrivalTrend: resource.arrival_trend,
      peakToMean: resource.peak_to_mean,
    };
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1OverviewResourceError('workload', error);
    throw error;
  }
}
