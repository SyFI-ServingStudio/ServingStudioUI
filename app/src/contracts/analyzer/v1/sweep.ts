import { z, ZodError } from 'zod';

import type { SweepAnalysis, SweepListItem } from '../../../domain/sweep';
import { analyzerV1ArtifactHrefSchema } from './artifactHref';

const nonEmptyString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: true });
const coordinatePrimitive = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const coordinateValue = z.union([coordinatePrimitive, z.array(coordinatePrimitive)]);
const lifecycleStage = z.enum(['not_started', 'pending', 'complete', 'failed']);

const sweepCatalogEntry = z
  .object({
    workspace_id: nonEmptyString,
    sweep_id: nonEmptyString,
    kind: z.enum(['sweep', 'singleton']),
    display_name: nonEmptyString,
    payload_href: analyzerV1ArtifactHrefSchema,
    axes: z.array(nonEmptyString),
    num_runs: z.number().int().nonnegative(),
    status: z.enum(['ready', 'pending']),
    experiment_date: z.string().date().nullable(),
    deployments: z.array(nonEmptyString),
    traces: z.array(nonEmptyString),
    updated_at: timestamp,
  })
  .strict();

const sweepCatalogSchema = z
  .object({
    protocol_version: z.literal(1),
    generated_at: timestamp,
    sweeps: z.array(sweepCatalogEntry),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seenSweepIds = new Set<string>();
    catalog.sweeps.forEach((sweep, index) => {
      if (seenSweepIds.has(sweep.sweep_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sweeps', index, 'sweep_id'],
          message: `duplicate sweep_id ${sweep.sweep_id}`,
        });
      }
      seenSweepIds.add(sweep.sweep_id);
    });
  });

const sweepPayloadSchema = z
  .object({
    protocol_version: z.literal(1),
    schema_version: z.literal(1),
    workspace_id: nonEmptyString,
    sweep_id: nonEmptyString,
    display_name: nonEmptyString,
    meta: z
      .object({
        num_axes: z.number().int().nonnegative(),
        num_runs: z.number().int().nonnegative(),
      })
      .strict(),
    axes: z.array(nonEmptyString),
    domains: z.record(z.array(coordinateValue)),
    metrics: z.array(
      z
        .object({
          group: nonEmptyString,
          key: nonEmptyString,
          label: nonEmptyString,
          unit: z.string(),
          objective: z.enum(['minimize', 'maximize']),
        })
        .strict(),
    ),
    runs: z.array(
      z
        .object({
          run_id: nonEmptyString.nullable(),
          coordinates: z.record(coordinateValue),
          labels: z.record(z.string()),
          lifecycle: z.object({ simulation: lifecycleStage, analysis: lifecycleStage }).strict(),
          metrics: z.record(z.number().finite().nullable()),
        })
        .strict(),
    ),
    definitions: z.record(z.string()),
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.meta.num_axes !== payload.axes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'num_axes'],
        message: 'must equal axes.length',
      });
    }
    if (payload.meta.num_runs !== payload.runs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'num_runs'],
        message: 'must equal runs.length',
      });
    }
    payload.axes.forEach((axis) => {
      if (!(axis in payload.domains)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['domains', axis],
          message: 'missing domain for declared axis',
        });
      }
    });
  });

type WireSweepCatalog = z.infer<typeof sweepCatalogSchema>;
type WireSweepPayload = z.infer<typeof sweepPayloadSchema>;

export interface AnalyzerV1SweepCatalogEntry extends SweepListItem {
  payloadHref: string;
}

export interface AnalyzerV1SweepCatalog {
  protocolVersion: 1;
  generatedAt: string;
  sweeps: readonly AnalyzerV1SweepCatalogEntry[];
}

export class AnalyzerV1SweepContractError extends Error {
  constructor(resource: string, error: ZodError) {
    super(
      `Invalid analyzer-v1 ${resource}:\n${error.issues
        .map((issue) => `- ${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'AnalyzerV1SweepContractError';
  }
}

function toCatalog(wire: WireSweepCatalog): AnalyzerV1SweepCatalog {
  return {
    protocolVersion: 1,
    generatedAt: wire.generated_at,
    sweeps: wire.sweeps.map((sweep) => ({
      workspaceId: sweep.workspace_id,
      sweepId: sweep.sweep_id,
      kind: sweep.kind,
      displayName: sweep.display_name,
      payloadHref: sweep.payload_href,
      axes: sweep.axes,
      numRuns: sweep.num_runs,
      status: sweep.status,
      experimentDate: sweep.experiment_date,
      deployments: sweep.deployments,
      traces: sweep.traces,
      updatedAt: sweep.updated_at,
    })),
  };
}

function toAnalysis(wire: WireSweepPayload): SweepAnalysis {
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    workspaceId: wire.workspace_id,
    sweepId: wire.sweep_id,
    displayName: wire.display_name,
    axes: wire.axes,
    domains: wire.domains,
    metrics: wire.metrics,
    runs: wire.runs.map((run) => ({
      runId: run.run_id,
      coordinates: run.coordinates,
      labels: run.labels,
      lifecycle: run.lifecycle,
      metrics: run.metrics,
    })),
    definitions: wire.definitions,
  };
}

export function parseAnalyzerV1SweepCatalog(input: unknown): AnalyzerV1SweepCatalog {
  try {
    return toCatalog(sweepCatalogSchema.parse(input));
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1SweepContractError('sweep catalog', error);
    throw error;
  }
}

export function parseAnalyzerV1SweepPayload(input: unknown): SweepAnalysis {
  try {
    return toAnalysis(sweepPayloadSchema.parse(input));
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1SweepContractError('sweep payload', error);
    throw error;
  }
}
