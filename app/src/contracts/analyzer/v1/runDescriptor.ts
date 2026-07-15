import { z, ZodError, type ZodIssue } from 'zod';

import type {
  ArtifactProvenance,
  ArtifactRef,
  RunDescriptor,
  SubjectArtifact,
  TraceResource,
} from '../../../domain/artifacts';
import { SUBJECT_NAMES, type SubjectName } from '../../../domain/subject';
import { makeWorkerRef } from '../../../domain/worker';

const nonEmptyString = z.string().trim().min(1);

const artifactRefSchema = z
  .object({
    href: nonEmptyString,
    media_type: nonEmptyString.optional(),
    schema_version: z.number().int().positive().optional(),
    byte_length: z.number().int().nonnegative().optional(),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  })
  .strict();

const pendingSchema = z
  .object({
    status: z.literal('pending'),
    reason: nonEmptyString.optional(),
  })
  .strict();

const unavailableSchema = z
  .object({
    status: z.literal('unavailable'),
    reason: nonEmptyString,
    code: nonEmptyString.optional(),
  })
  .strict();

const notGeneratedSchema = z
  .object({
    status: z.literal('not_generated'),
    reason: nonEmptyString.optional(),
  })
  .strict();

const failedSchema = z
  .object({
    status: z.literal('failed'),
    code: nonEmptyString,
    reason: nonEmptyString,
  })
  .strict();

const readySubjectSchema = z
  .object({
    status: z.literal('ready'),
    schema_version: z.number().int().positive(),
    report_href: nonEmptyString.optional(),
    payload_href: nonEmptyString.optional(),
  })
  .strict()
  .refine((resource) => resource.report_href !== undefined || resource.payload_href !== undefined, {
    message: 'ready subject requires report_href or payload_href',
  });

const subjectArtifactSchema = z.union([
  readySubjectSchema,
  pendingSchema,
  unavailableSchema,
  notGeneratedSchema,
  failedSchema,
]);

const traceResourceSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      href: nonEmptyString,
      media_type: nonEmptyString.optional(),
      byte_length: z.number().int().nonnegative().optional(),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    })
    .strict(),
  pendingSchema,
  unavailableSchema,
  notGeneratedSchema,
  failedSchema,
]);

const provenanceSchema = z.discriminatedUnion('source', [
  z
    .object({
      source: z.literal('analyzer'),
      synthetic: z.literal(false),
      generated_at: nonEmptyString.optional(),
      generator_version: nonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      source: z.literal('fixture'),
      synthetic: z.boolean(),
      fixture_id: nonEmptyString,
      source_run: nonEmptyString.optional(),
      generated_at: nonEmptyString.optional(),
    })
    .strict(),
]).refine(
  (provenance) => provenance.source !== 'fixture' || provenance.synthetic || provenance.source_run !== undefined,
  { message: 'a non-synthetic fixture requires source_run' },
);

const workerRefSchema = z
  .object({
    pool_tag: nonEmptyString,
    worker_id: z.union([nonEmptyString, z.number().int().nonnegative()]),
  })
  .strict();

const subjectNameSchema = z.enum(SUBJECT_NAMES);

/** Wire schema is deliberately snake_case and strict at every object boundary. */
export const analyzerV1RunDescriptorSchema = z
  .object({
    protocol_version: z.literal(1),
    run_id: nonEmptyString,
    kind: z.literal('simulation'),
    display_name: nonEmptyString.optional(),
    model_name: nonEmptyString.optional(),
    deployment: z.enum(['unified', 'afd']),
    lifecycle: z
      .object({
        simulation: z.enum(['not_started', 'pending', 'complete', 'failed']),
        analysis: z.enum(['not_started', 'pending', 'complete', 'failed']),
      })
      .strict(),
    summary: artifactRefSchema,
    model: artifactRefSchema.optional(),
    topology: artifactRefSchema.optional(),
    workers: z.array(workerRefSchema).optional(),
    subjects: z.record(subjectNameSchema, subjectArtifactSchema),
    traces: z.record(nonEmptyString, traceResourceSchema),
    provenance: provenanceSchema.optional(),
  })
  .strict();

type WireArtifactRef = z.infer<typeof artifactRefSchema>;
type WireSubjectArtifact = z.infer<typeof subjectArtifactSchema>;
type WireTraceResource = z.infer<typeof traceResourceSchema>;
type WireProvenance = z.infer<typeof provenanceSchema>;

function toArtifactRef(resource: WireArtifactRef): ArtifactRef {
  return {
    href: resource.href,
    ...(resource.media_type === undefined ? {} : { mediaType: resource.media_type }),
    ...(resource.schema_version === undefined ? {} : { schemaVersion: resource.schema_version }),
    ...(resource.byte_length === undefined ? {} : { byteLength: resource.byte_length }),
    ...(resource.sha256 === undefined ? {} : { sha256: resource.sha256 }),
  };
}

function toSubjectArtifact(resource: WireSubjectArtifact): SubjectArtifact {
  if (resource.status !== 'ready') return resource;

  const common = {
    status: 'ready' as const,
    schemaVersion: resource.schema_version,
  };
  const report = resource.report_href === undefined ? undefined : { href: resource.report_href };
  const payload = resource.payload_href === undefined ? undefined : { href: resource.payload_href };

  if (report !== undefined) return { ...common, report, ...(payload === undefined ? {} : { payload }) };
  // Reaching this guard would mean the schema and mapper invariants diverged.
  if (payload === undefined) throw new Error('Validated ready subject has no artifact href');
  return { ...common, payload };
}

function toTraceResource(resource: WireTraceResource): TraceResource {
  if (resource.status !== 'ready') return resource;
  return {
    status: 'ready',
    artifact: toArtifactRef({
      href: resource.href,
      media_type: resource.media_type,
      byte_length: resource.byte_length,
      sha256: resource.sha256,
    }),
  };
}

function toProvenance(provenance: WireProvenance): ArtifactProvenance {
  if (provenance.source === 'fixture') {
    return {
      source: 'fixture',
      synthetic: provenance.synthetic,
      fixtureId: provenance.fixture_id,
      ...(provenance.source_run === undefined ? {} : { sourceRun: provenance.source_run }),
      ...(provenance.generated_at === undefined ? {} : { generatedAt: provenance.generated_at }),
    };
  }
  return {
    source: 'analyzer',
    synthetic: false,
    ...(provenance.generated_at === undefined ? {} : { generatedAt: provenance.generated_at }),
    ...(provenance.generator_version === undefined ? {} : { generatorVersion: provenance.generator_version }),
  };
}

function toRunDescriptor(wire: z.infer<typeof analyzerV1RunDescriptorSchema>): RunDescriptor {
  const subjects: Partial<Record<SubjectName, SubjectArtifact>> = {};
  for (const subjectName of SUBJECT_NAMES) {
    const resource = wire.subjects[subjectName];
    if (resource !== undefined) subjects[subjectName] = toSubjectArtifact(resource);
  }

  const traces = Object.fromEntries(
    Object.entries(wire.traces).map(([traceName, resource]) => [traceName, toTraceResource(resource)]),
  );

  return {
    protocolVersion: 1,
    runId: wire.run_id,
    kind: 'simulation',
    ...(wire.display_name === undefined ? {} : { displayName: wire.display_name }),
    ...(wire.model_name === undefined ? {} : { modelName: wire.model_name }),
    deployment: wire.deployment,
    lifecycle: wire.lifecycle,
    summary: toArtifactRef(wire.summary),
    ...(wire.model === undefined ? {} : { model: toArtifactRef(wire.model) }),
    ...(wire.topology === undefined ? {} : { topology: toArtifactRef(wire.topology) }),
    ...(wire.workers === undefined
      ? {}
      : { workers: wire.workers.map((worker) => makeWorkerRef(worker.pool_tag, worker.worker_id)) }),
    subjects,
    traces,
    ...(wire.provenance === undefined ? {} : { provenance: toProvenance(wire.provenance) }),
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1RunDescriptorError extends Error {
  readonly issues: readonly string[];

  constructor(error: ZodError) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 run descriptor:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunDescriptorError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1RunDescriptor(input: unknown): RunDescriptor {
  try {
    return toRunDescriptor(analyzerV1RunDescriptorSchema.parse(input));
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1RunDescriptorError(error);
    throw error;
  }
}
