import { z, ZodError, type ZodIssue } from 'zod';

import type { RunKind, RunLifecycle } from '../../../domain/artifacts';
import { analyzerV1ArtifactHrefSchema } from './artifactHref';

// Wire identities are validated without trimming or otherwise normalizing
// them. In particular, run_id is an opaque server-issued token, not a path or
// a ULID that the UI may interpret.
const nonEmptyString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });

const timestampSchema = z.string().datetime({ offset: true });

const lifecycleSchema = z
  .object({
    simulation: z.enum(['not_started', 'pending', 'complete', 'failed']),
    analysis: z.enum(['not_started', 'pending', 'complete', 'failed']),
  })
  .strict();

const runCatalogEntrySchema = z
  .object({
    workspace_id: nonEmptyString,
    run_id: nonEmptyString,
    kind: z.literal('simulation'),
    display_name: nonEmptyString,
    descriptor_href: analyzerV1ArtifactHrefSchema,
    lifecycle: lifecycleSchema,
    updated_at: timestampSchema,
  })
  .strict();

/** Wire schema is deliberately snake_case and strict at every object boundary. */
export const analyzerV1RunCatalogSchema = z
  .object({
    protocol_version: z.literal(1),
    generated_at: timestampSchema,
    runs: z.array(runCatalogEntrySchema),
  })
  .strict()
  .superRefine((catalog, context) => {
    const seenRunIds = new Set<string>();
    catalog.runs.forEach((run, index) => {
      if (seenRunIds.has(run.run_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['runs', index, 'run_id'],
          message: `duplicate run_id ${run.run_id}`,
        });
      }
      seenRunIds.add(run.run_id);
    });
  });

/** Domain-facing catalog row. The repository resolves descriptorHref. */
export interface AnalyzerV1RunCatalogEntry {
  workspaceId: string;
  runId: string;
  kind: RunKind;
  displayName: string;
  descriptorHref: string;
  lifecycle: RunLifecycle;
  updatedAt: string;
}

/** Decoded catalog in server order; parsing never sorts discovery results. */
export interface AnalyzerV1RunCatalog {
  protocolVersion: 1;
  generatedAt: string;
  runs: readonly AnalyzerV1RunCatalogEntry[];
}

type WireRunCatalog = z.infer<typeof analyzerV1RunCatalogSchema>;

function toRunCatalog(wire: WireRunCatalog): AnalyzerV1RunCatalog {
  return {
    protocolVersion: 1,
    generatedAt: wire.generated_at,
    runs: wire.runs.map((run) => ({
      workspaceId: run.workspace_id,
      runId: run.run_id,
      kind: 'simulation',
      displayName: run.display_name,
      descriptorHref: run.descriptor_href,
      lifecycle: run.lifecycle,
      updatedAt: run.updated_at,
    })),
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1RunCatalogError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 run catalog:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunCatalogError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1RunCatalog(input: unknown): AnalyzerV1RunCatalog {
  try {
    return toRunCatalog(analyzerV1RunCatalogSchema.parse(input));
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1RunCatalogError(error);
    throw error;
  }
}
