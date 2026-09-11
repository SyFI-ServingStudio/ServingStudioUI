import { z, ZodError } from 'zod';

export type SweepStatus = 'ready' | 'pending';
export type SweepPrimitive = string | number | boolean | null;
export type SweepCoordinateValue = SweepPrimitive | readonly SweepPrimitive[];

export interface SweepListItem {
  workspaceId: string;
  sweepId: string;
  kind: 'sweep' | 'singleton';
  displayName: string;
  axes: readonly string[];
  numRuns: number;
  status: SweepStatus;
  experimentDate: string | null;
  deployments: readonly string[];
  traces: readonly string[];
  updatedAt: string;
}

export interface SweepMetric {
  key: string;
  label: string;
  group: string;
  unit: string;
  objective: 'minimize' | 'maximize';
}

export interface SweepRun {
  runId: string | null;
  coordinates: Readonly<Record<string, SweepCoordinateValue>>;
  labels: Readonly<Record<string, string>>;
  lifecycle: {
    simulation: 'not_started' | 'pending' | 'complete' | 'failed';
    analysis: 'not_started' | 'pending' | 'complete' | 'failed';
  };
  metrics: Readonly<Record<string, number | null>>;
}

export interface SweepAnalysis {
  protocolVersion: 1;
  schemaVersion: 1;
  workspaceId: string;
  sweepId: string;
  displayName: string;
  axes: readonly string[];
  domains: Readonly<Record<string, readonly SweepCoordinateValue[]>>;
  metrics: readonly SweepMetric[];
  runs: readonly SweepRun[];
  definitions: Readonly<Record<string, string>>;
}

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
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    if (payload.meta.num_axes !== payload.axes.length) {
      issue(['meta', 'num_axes'], 'must equal axes.length');
    }
    if (payload.meta.num_runs !== payload.runs.length) {
      issue(['meta', 'num_runs'], 'must equal runs.length');
    }
    const axes = new Set(payload.axes);
    if (axes.size !== payload.axes.length) issue(['axes'], 'axis names must be unique');
    const domainKeys = Object.keys(payload.domains);
    if (domainKeys.length !== axes.size || domainKeys.some((axis) => !axes.has(axis))) {
      issue(['domains'], 'keys must exactly equal the declared axes');
    }
    const metricKeys = payload.metrics.map((metric) => metric.key);
    const metricSet = new Set(metricKeys);
    if (metricSet.size !== metricKeys.length) issue(['metrics'], 'metric keys must be unique');

    const tupleKeys = new Set<string>();
    payload.runs.forEach((run, runIndex) => {
      const coordinateKeys = Object.keys(run.coordinates);
      if (coordinateKeys.length !== axes.size || coordinateKeys.some((axis) => !axes.has(axis))) {
        issue(['runs', runIndex, 'coordinates'], 'keys must exactly equal the declared axes');
      }
      const runMetricKeys = Object.keys(run.metrics);
      if (metricKeys.some((metric) => !runMetricKeys.includes(metric))) {
        issue(['runs', runIndex, 'metrics'], 'must contain every metric descriptor key');
      }
      const tuple = JSON.stringify(payload.axes.map((axis) => run.coordinates[axis]));
      if (tupleKeys.has(tuple))
        issue(['runs', runIndex, 'coordinates'], 'coordinate tuple is not unique');
      tupleKeys.add(tuple);
    });

    payload.axes.forEach((axis) => {
      const domain = payload.domains[axis];
      if (!domain) return;
      const declared = domain.map((value) => JSON.stringify(value));
      if (new Set(declared).size !== declared.length) {
        issue(['domains', axis], 'domain values must be unique');
      }
      const derived = new Set(payload.runs.map((run) => JSON.stringify(run.coordinates[axis])));
      const declaredSet = new Set(declared);
      if (
        derived.size !== declaredSet.size ||
        [...derived].some((value) => !declaredSet.has(value))
      ) {
        issue(['domains', axis], 'must equal the values derived from run coordinates');
      }
    });
  });

type WireSweepCatalog = z.infer<typeof sweepCatalogSchema>;
type WireSweepPayload = z.infer<typeof sweepPayloadSchema>;

export type AnalyzerV1SweepCatalogEntry = SweepListItem;

export interface AnalyzerV1SweepCatalog {
  protocolVersion: 1;
  generatedAt: string;
  sweeps: readonly AnalyzerV1SweepCatalogEntry[];
}

export class AnalyzerV1SweepContractError extends Error {
  readonly issues: readonly string[];
  readonly received?: number;

  constructor(resource: string, error: ZodError | readonly string[], received?: number) {
    const issues =
      error instanceof ZodError
        ? error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        : error;
    super(`Invalid analyzer-v1 ${resource}:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.issues = issues;
    this.received = received;
    this.name = 'AnalyzerV1SweepContractError';
  }
}

function receivedVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || !('schema_version' in input)) return undefined;
  const value = input.schema_version;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
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

export function parseAnalyzerV1SweepPayload(
  input: unknown,
  expected?: { readonly workspace: string; readonly id: string },
): SweepAnalysis {
  try {
    const analysis = toAnalysis(sweepPayloadSchema.parse(input));
    if (
      expected !== undefined &&
      (analysis.workspaceId !== expected.workspace || analysis.sweepId !== expected.id)
    ) {
      throw new AnalyzerV1SweepContractError(
        'sweep payload',
        [
          `identity: describes ${analysis.workspaceId}/${analysis.sweepId}, asked for ${expected.workspace}/${expected.id}`,
        ],
        1,
      );
    }
    return analysis;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AnalyzerV1SweepContractError('sweep payload', error, receivedVersion(input));
    }
    throw error;
  }
}
