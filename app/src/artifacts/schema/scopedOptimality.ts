import { z } from 'zod';

export const SCOPED_OPTIMALITY_SCHEMA_VERSION = 1;

export interface ScopedOptimalityRung {
  readonly key: string;
  readonly gpuSeconds: number;
  readonly definition: string;
}

export interface ScopedOptimalityReport {
  readonly section: string;
  readonly canonicalPath: string;
  readonly nodeKind: string;
  readonly nodeLabel: string | null;
  readonly matchedWorkers: number;
  readonly matchedRows: number;
  readonly descendantLeaves: readonly string[];
  readonly rungs: readonly ScopedOptimalityRung[];
  readonly omittedRungs: readonly { readonly rung: string; readonly reason: string }[];
}

export class IncompatibleScopedOptimalityError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(
      `scoped optimality artifact is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'IncompatibleScopedOptimalityError';
  }
}

const rungSchema = z.object({
  value_gpu_seconds: z.number().finite().nonnegative(),
  unit: z.string(),
  definition: z.string(),
});

const omittedRungSchema = z.object({
  rung: z.string().min(1),
  reason: z.string(),
});

const reportSchema = z.object({
  schema_version: z.literal(SCOPED_OPTIMALITY_SCHEMA_VERSION),
  report_type: z.literal('optimality_scoped_v1'),
  selection: z.object({
    selector: z.object({
      path: z.string().nullable(),
      label: z.string().nullable(),
    }),
    section: z.string().min(1),
    canonical_path: z.string().min(1),
    node_kind: z.string().min(1),
    node_label: z.string().nullable(),
    matched_manifest_workers: z.number().int().nonnegative(),
    matched_cost_log_rows: z.number().int().nonnegative(),
    descendant_leaves: z.array(z.string()),
  }),
  rungs: z.record(z.string(), rungSchema),
  omitted_rungs: z.array(omittedRungSchema),
});

export function parseAnalyzerV1ScopedOptimality(input: unknown): ScopedOptimalityReport {
  const result = reportSchema.safeParse(input);
  if (!result.success) {
    const received =
      typeof input === 'object' &&
      input !== null &&
      'schema_version' in input &&
      typeof input.schema_version === 'number'
        ? input.schema_version
        : undefined;
    throw new IncompatibleScopedOptimalityError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
      received,
    );
  }
  const parsed = result.data;
  return {
    section: parsed.selection.section,
    canonicalPath: parsed.selection.canonical_path,
    nodeKind: parsed.selection.node_kind,
    nodeLabel: parsed.selection.node_label,
    matchedWorkers: parsed.selection.matched_manifest_workers,
    matchedRows: parsed.selection.matched_cost_log_rows,
    descendantLeaves: parsed.selection.descendant_leaves,
    rungs: Object.entries(parsed.rungs).map(([key, rung]) => ({
      key,
      gpuSeconds: rung.value_gpu_seconds,
      definition: rung.definition,
    })),
    omittedRungs: parsed.omitted_rungs.map((omission) => ({
      rung: omission.rung,
      reason: omission.reason,
    })),
  };
}
