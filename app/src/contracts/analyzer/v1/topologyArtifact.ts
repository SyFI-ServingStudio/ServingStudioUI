import { z, ZodError, type ZodIssue } from 'zod';

import type { Deployment } from '../../../domain/deployment';
import type { Topology } from '../../../domain/run';
import { parseAnalyzerV1Topology } from './topology';

/** The HTTP service keeps simulator-owned params/run_meta intact. This small
 * envelope gives the resource its own version without inventing a second
 * topology model or duplicating the existing analyzer-v1 adapter. */
const analyzerV1TopologyArtifactSchema = z
  .object({
    schema_version: z.literal(1),
    params: z.unknown(),
    run_meta: z.unknown(),
  })
  .strict();

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1TopologyArtifactError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(
      `Invalid analyzer-v1 topology artifact:\n${issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    this.name = 'AnalyzerV1TopologyArtifactError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1TopologyArtifact(
  input: unknown,
  expectedDeployment: Deployment,
): Topology {
  try {
    const wire = analyzerV1TopologyArtifactSchema.parse(input);
    return parseAnalyzerV1Topology(wire.params, wire.run_meta, expectedDeployment);
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1TopologyArtifactError(error);
    throw error;
  }
}
