import { z, ZodError, type ZodIssue } from 'zod';

import type {
  ArtifactCapability,
  ArtifactProvenance,
  ArtifactViews,
  DescriptorSubjectName,
  DetailArtifact,
  RunDescriptor,
  SubjectArtifact,
  TraceDownload,
  TraceResource,
} from '../ref';
import { analyzerV1ArtifactHrefSchema } from './artifactHref';
import { analyzerV1ViewsSchema } from './capability';

const DEPLOYMENTS = ['unified', 'pd', 'afd'] as const;

/** Wire subject ids are protocol spelling; panels use stable domain names. */
const SUBJECT_TO_DOMAIN = {
  'slo-general': 'slo',
  throughput: 'throughput',
  utilization: 'utilization',
  'kv-occupancy': 'kv',
  concurrency: 'concurrency',
  backpressure: 'backpressure',
  'request-state': 'requestState',
  batch: 'batch',
  'kernel-throughput': 'kernelThroughput',
  'workload-conservation': 'conservation',
  'kernel-input-distribution': 'kernelInputDistribution',
  'kernel-time-share': 'kernelTimeShare',
  optimality: 'optimality',
} as const satisfies Readonly<Record<string, DescriptorSubjectName>>;

function domainSubjectName(subjectId: string): DescriptorSubjectName | undefined {
  if (!Object.prototype.hasOwnProperty.call(SUBJECT_TO_DOMAIN, subjectId)) return undefined;
  return SUBJECT_TO_DOMAIN[subjectId as keyof typeof SUBJECT_TO_DOMAIN];
}

const nonEmptyString = z.string().trim().min(1);

// Server-issued identities are opaque. Validate blankness without transforming
// their bytes so catalog and descriptor keys remain exactly comparable.
const opaqueIdentityString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });

const artifactCapabilitySchema = z
  .object({
    views: analyzerV1ViewsSchema,
    media_type: nonEmptyString.optional(),
    schema_version: z.number().int().positive().optional(),
    byte_length: z.number().int().nonnegative().optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
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

const readySubjectViewsSchema = z.object({ views: analyzerV1ViewsSchema }).strict();

// A variant key is also its address segment, so it is constrained to what the
// service will route rather than to any non-blank string.
const variantNameSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

const readySubjectSchema = z
  .object({
    status: z.literal('ready'),
    schema_version: z.number().int().positive(),
    views: analyzerV1ViewsSchema,
    variants: z.record(variantNameSchema, readySubjectViewsSchema).optional(),
  })
  .strict();

const subjectArtifactSchema = z.union([
  readySubjectSchema,
  pendingSchema,
  unavailableSchema,
  notGeneratedSchema,
  failedSchema,
]);

// Forward compatibility lives at the subject boundary: a previous UI validates
// subjects it understands and completely ignores future registry rows, including
// envelope shapes introduced by a newer analyzer.
const subjectsSchema = z
  .record(opaqueIdentityString, z.unknown())
  .transform((subjects, context) => {
    const recognizedSubjects: Record<string, z.infer<typeof subjectArtifactSchema>> = {};
    for (const [subjectId, resource] of Object.entries(subjects)) {
      if (domainSubjectName(subjectId) === undefined) continue;

      const parsedResource = subjectArtifactSchema.safeParse(resource);
      if (parsedResource.success) {
        recognizedSubjects[subjectId] = parsedResource.data;
        continue;
      }
      for (const issue of parsedResource.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [subjectId, ...issue.path],
          message: issue.message,
        });
      }
    }
    return recognizedSubjects;
  });

const traceResourceSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('ready'),
      href: analyzerV1ArtifactHrefSchema,
      media_type: nonEmptyString.optional(),
      byte_length: z.number().int().nonnegative().optional(),
      sha256: z
        .string()
        .regex(/^[a-fA-F0-9]{64}$/)
        .optional(),
    })
    .strict(),
  pendingSchema,
  unavailableSchema,
  notGeneratedSchema,
  failedSchema,
]);

const provenanceSchema = z
  .discriminatedUnion('source', [
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
  ])
  .refine(
    (provenance) =>
      provenance.source !== 'fixture' ||
      provenance.synthetic ||
      provenance.source_run !== undefined,
    { message: 'a non-synthetic fixture requires source_run' },
  );

const workerRefSchema = z
  .object({
    pool_tag: opaqueIdentityString,
    worker_id: z.union([opaqueIdentityString, z.number().int().nonnegative().safe()]),
  })
  .strict();

const readyDetailSchema = z
  .object({
    status: z.literal('ready'),
    schema_version: z.number().int().positive(),
    views: analyzerV1ViewsSchema,
  })
  .strict();

const detailArtifactSchema = z.union([
  readyDetailSchema,
  pendingSchema,
  unavailableSchema,
  notGeneratedSchema,
  failedSchema,
]);

const analysisSchema = z
  .object({
    revision: nonEmptyString,
    generated_at: z.string().datetime({ offset: true }),
    generator_version: nonEmptyString,
  })
  .strict();

/** Wire schema is deliberately snake_case and strict at every object boundary. */
export const analyzerV1RunDescriptorSchema = z
  .object({
    protocol_version: z.literal(1),
    workspace_id: opaqueIdentityString,
    run_id: opaqueIdentityString,
    kind: z.literal('simulation'),
    display_name: nonEmptyString.optional(),
    model_name: nonEmptyString.optional(),
    deployment: z.enum(DEPLOYMENTS),
    lifecycle: z
      .object({
        simulation: z.enum(['not_started', 'pending', 'complete', 'failed']),
        analysis: z.enum(['not_started', 'pending', 'complete', 'failed']),
      })
      .strict(),
    summary: artifactCapabilitySchema,
    model: artifactCapabilitySchema.optional(),
    workload: artifactCapabilitySchema.optional(),
    topology: artifactCapabilitySchema.optional(),
    workers: z.array(workerRefSchema).optional(),
    subjects: subjectsSchema,
    details: z.record(opaqueIdentityString, detailArtifactSchema).default({}),
    traces: z.record(opaqueIdentityString, traceResourceSchema),
    analysis: analysisSchema.optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict()
  .superRefine((descriptor, context) => {
    if (descriptor.lifecycle.analysis === 'complete' && descriptor.analysis === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['analysis'],
        message: 'is required when lifecycle.analysis is complete',
      });
    }
  });

type WireArtifactCapability = z.infer<typeof artifactCapabilitySchema>;
type WireSubjectArtifact = z.infer<typeof subjectArtifactSchema>;
type WireTraceResource = z.infer<typeof traceResourceSchema>;
type WireProvenance = z.infer<typeof provenanceSchema>;
type WireDetailArtifact = z.infer<typeof detailArtifactSchema>;

function toArtifactCapability(resource: WireArtifactCapability): ArtifactCapability {
  return {
    views: resource.views satisfies ArtifactViews,
    ...(resource.media_type === undefined ? {} : { mediaType: resource.media_type }),
    ...(resource.schema_version === undefined ? {} : { schemaVersion: resource.schema_version }),
    ...(resource.byte_length === undefined ? {} : { byteLength: resource.byte_length }),
    ...(resource.sha256 === undefined ? {} : { sha256: resource.sha256 }),
  };
}

function toSubjectArtifact(resource: WireSubjectArtifact): SubjectArtifact {
  if (resource.status !== 'ready') return resource;
  return {
    status: 'ready',
    schemaVersion: resource.schema_version,
    views: resource.views,
    ...(resource.variants === undefined
      ? {}
      : {
          variants: Object.fromEntries(
            Object.entries(resource.variants).map(([name, variant]) => [
              name,
              { views: variant.views },
            ]),
          ),
        }),
  };
}

function toTraceResource(resource: WireTraceResource): TraceResource {
  if (resource.status !== 'ready') return resource;
  const artifact: TraceDownload = {
    href: resource.href,
    ...(resource.media_type === undefined ? {} : { mediaType: resource.media_type }),
    ...(resource.byte_length === undefined ? {} : { byteLength: resource.byte_length }),
    ...(resource.sha256 === undefined ? {} : { sha256: resource.sha256 }),
  };
  return { status: 'ready', artifact };
}

function toDetailArtifact(resource: WireDetailArtifact): DetailArtifact {
  if (resource.status !== 'ready') return resource;
  return {
    status: 'ready',
    schemaVersion: resource.schema_version,
    views: resource.views,
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
    ...(provenance.generator_version === undefined
      ? {}
      : { generatorVersion: provenance.generator_version }),
  };
}

function toRunDescriptor(wire: z.infer<typeof analyzerV1RunDescriptorSchema>): RunDescriptor {
  const subjects: Partial<Record<DescriptorSubjectName, SubjectArtifact>> = {};
  for (const [subjectId, resource] of Object.entries(wire.subjects)) {
    const subjectName = domainSubjectName(subjectId);
    if (subjectName !== undefined) subjects[subjectName] = toSubjectArtifact(resource);
  }

  const traces = Object.fromEntries(
    Object.entries(wire.traces).map(([traceName, resource]) => [
      traceName,
      toTraceResource(resource),
    ]),
  );
  const details = Object.fromEntries(
    Object.entries(wire.details).map(([detailName, resource]) => [
      detailName,
      toDetailArtifact(resource),
    ]),
  );

  return {
    protocolVersion: 1,
    workspaceId: wire.workspace_id,
    runId: wire.run_id,
    kind: 'simulation',
    ...(wire.display_name === undefined ? {} : { displayName: wire.display_name }),
    ...(wire.model_name === undefined ? {} : { modelName: wire.model_name }),
    deployment: wire.deployment,
    lifecycle: wire.lifecycle,
    summary: toArtifactCapability(wire.summary),
    ...(wire.model === undefined ? {} : { model: toArtifactCapability(wire.model) }),
    ...(wire.workload === undefined ? {} : { workload: toArtifactCapability(wire.workload) }),
    ...(wire.topology === undefined ? {} : { topology: toArtifactCapability(wire.topology) }),
    ...(wire.workers === undefined
      ? {}
      : {
          workers: wire.workers.map((worker) => ({
            poolTag: worker.pool_tag,
            workerId: String(worker.worker_id),
          })),
        }),
    subjects,
    details,
    traces,
    ...(wire.analysis === undefined
      ? {}
      : {
          analysis: {
            revision: wire.analysis.revision,
            generatedAt: wire.analysis.generated_at,
            generatorVersion: wire.analysis.generator_version,
          },
        }),
    ...(wire.provenance === undefined ? {} : { provenance: toProvenance(wire.provenance) }),
  };
}

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export class AnalyzerV1RunDescriptorError extends Error {
  readonly issues: readonly string[];
  readonly received: number | undefined;

  constructor(error: ZodError, input: unknown) {
    const issues = error.issues.map(formatIssue);
    super(`Invalid analyzer-v1 run descriptor:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunDescriptorError';
    this.issues = issues;
    const protocolVersion =
      typeof input === 'object' && input !== null
        ? Reflect.get(input, 'protocol_version')
        : undefined;
    this.received = typeof protocolVersion === 'number' ? protocolVersion : undefined;
  }
}

export interface ExpectedRunDescriptorIdentity {
  readonly workspaceId: string;
  readonly runId: string;
}

export class AnalyzerV1RunDescriptorIdentityError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Run descriptor identity mismatch:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AnalyzerV1RunDescriptorIdentityError';
    this.issues = issues;
  }
}

export function parseAnalyzerV1RunDescriptor(
  input: unknown,
  expected?: ExpectedRunDescriptorIdentity,
): RunDescriptor {
  try {
    const descriptor = toRunDescriptor(analyzerV1RunDescriptorSchema.parse(input));
    if (expected === undefined) return descriptor;

    const issues: string[] = [];
    if (descriptor.workspaceId !== expected.workspaceId) {
      issues.push(
        `workspace_id: expected ${JSON.stringify(expected.workspaceId)}, received ${JSON.stringify(descriptor.workspaceId)}`,
      );
    }
    if (descriptor.runId !== expected.runId) {
      issues.push(
        `run_id: expected ${JSON.stringify(expected.runId)}, received ${JSON.stringify(descriptor.runId)}`,
      );
    }
    if (issues.length > 0) throw new AnalyzerV1RunDescriptorIdentityError(issues);
    return descriptor;
  } catch (error) {
    if (error instanceof ZodError) throw new AnalyzerV1RunDescriptorError(error, input);
    throw error;
  }
}
