import { z } from 'zod';

import type { ScopedOptimalityReport } from '../../../domain/scopedOptimality';

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
  schema_version: z.literal(1),
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
  const parsed = reportSchema.parse(input);
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
