import { z } from 'zod';

import type {
  KernelRateStats,
  KernelThroughput,
  KernelThroughputLocation,
} from '../../../domain/kernelThroughput';
import type { SubjectResult } from '../../../domain/subject';
import {
  duplicateKeyIssues,
  formatZodIssue,
  incompatiblePayload,
  nonNegativeCount,
  nonNegativeNumber,
  positiveCount,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const TFLOPS_DEFINITION = 'achieved compute = slot_flops / (slot_time_ms/1000) / 1e12 (TFLOP/s)';
const GBPS_DEFINITION = 'achieved memory bandwidth = slot_bytes / (slot_time_ms/1000) / 1e9 (GB/s)';

const nullableRate = nonNegativeNumber.nullable();
const statsSchema = z.object({
  n: nonNegativeCount,
  mean: nullableRate,
  p50: nullableRate,
  p90: nullableRate,
  p99: nullableRate,
  max: nullableRate,
});

const locationSchema = z.object({
  name: wireIdentityString,
  kind: wireIdentityString,
  tflops: statsSchema,
  gbps: statsSchema,
});

const definitionsSchema = z
  .object({
    scope: wireIdentityString,
    location: wireIdentityString,
    tflops: z.literal(TFLOPS_DEFINITION),
    gbps: z.literal(GBPS_DEFINITION),
    sentinel: wireIdentityString,
    stats: wireIdentityString,
  })
  .catchall(wireIdentityString);

const readySchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(true),
  meta: z.object({
    log_dir: wireIdentityString,
    num_locations: positiveCount,
    sample_stride: positiveCount,
    sampled_compute_slots: nonNegativeCount,
    sampled_memory_slots: nonNegativeCount,
    sampled_rows: positiveCount,
  }),
  locations: z.array(locationSchema).min(1),
  definitions: definitionsSchema,
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  locations: z.array(z.unknown()).length(0),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type StatsWire = z.infer<typeof statsSchema>;
type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return !('available' in wire) || wire.available !== true;
}

/** Availability selects the intended envelope so malformed payload errors keep
 * their field paths instead of Zod's generic union-level "Invalid input". */
function wireFormatIssues(input: unknown, fallback: readonly z.ZodIssue[]): string[] {
  if (typeof input !== 'object' || input === null) return fallback.map(formatZodIssue);
  if ('available' in input && input.available === true) {
    const ready = readySchema.safeParse(input);
    if (!ready.success) return ready.error.issues.map(formatZodIssue);
  }
  if ('meta' in input && typeof input.meta === 'object' && input.meta !== null) {
    const meta = input.meta as Record<string, unknown>;
    if (meta.available === false) {
      const unavailable = unavailableSchema.safeParse(input);
      if (!unavailable.success) return unavailable.error.issues.map(formatZodIssue);
    }
  }
  return fallback.map(formatZodIssue);
}

export type KernelThroughputDecodeResult =
  | {
      subject: 'kernelThroughput';
      status: 'ready';
      schemaVersion: 1;
      payload: KernelThroughput;
    }
  | Extract<SubjectResult<'kernelThroughput'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'kernelThroughput'>, { status: 'incompatible' }>;

const STAT_FIELDS = ['mean', 'p50', 'p90', 'p99', 'max'] as const;

function statsIssues(path: string, stats: StatsWire): string[] {
  const issues: string[] = [];
  const values = STAT_FIELDS.map((field) => stats[field]);
  if (stats.n === 0) {
    STAT_FIELDS.forEach((field) => {
      if (stats[field] !== null) issues.push(`${path}.${field}: must be null when n is zero`);
    });
    return issues;
  }

  STAT_FIELDS.forEach((field) => {
    if (stats[field] === null) issues.push(`${path}.${field}: must be present when n is positive`);
  });
  if (values.some((value) => value === null)) return issues;

  const [mean, p50, p90, p99, max] = values as number[];
  if (mean > max) issues.push(`${path}.mean: must not exceed max`);
  if (p50 > p90) issues.push(`${path}.p50: must not exceed p90`);
  if (p90 > p99) issues.push(`${path}.p90: must not exceed p99`);
  if (p99 > max) issues.push(`${path}.p99: must not exceed max`);
  return issues;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('locations', wire.locations, (location) => location.name);
  if (wire.meta.num_locations !== wire.locations.length) {
    issues.push(
      `meta.num_locations: expected ${wire.locations.length}, got ${wire.meta.num_locations}`,
    );
  }

  wire.locations.forEach((location, index) => {
    issues.push(...statsIssues(`locations.${index}.tflops`, location.tflops));
    issues.push(...statsIssues(`locations.${index}.gbps`, location.gbps));
    if (location.tflops.n === 0 && location.gbps.n === 0) {
      issues.push(`locations.${index}: must contain compute or memory samples`);
    }
    if (index > 0 && location.name < wire.locations[index - 1].name) {
      issues.push(`locations.${index}.name: locations must be sorted by name`);
    }
  });

  const computeSlots = wire.locations.reduce((total, location) => total + location.tflops.n, 0);
  const memorySlots = wire.locations.reduce((total, location) => total + location.gbps.n, 0);
  if (wire.meta.sampled_compute_slots !== computeSlots) {
    issues.push(
      `meta.sampled_compute_slots: expected location total ${computeSlots}, got ${wire.meta.sampled_compute_slots}`,
    );
  }
  if (wire.meta.sampled_memory_slots !== memorySlots) {
    issues.push(
      `meta.sampled_memory_slots: expected location total ${memorySlots}, got ${wire.meta.sampled_memory_slots}`,
    );
  }
  return issues;
}

function toStats(stats: StatsWire): KernelRateStats {
  return {
    sampleCount: stats.n,
    mean: stats.mean,
    p50: stats.p50,
    p90: stats.p90,
    p99: stats.p99,
    max: stats.max,
  };
}

function toLocation(location: ReadyWire['locations'][number]): KernelThroughputLocation {
  return {
    name: location.name,
    kind: location.kind,
    tflops: toStats(location.tflops),
    gbps: toStats(location.gbps),
  };
}

function toKernelThroughput(wire: ReadyWire): KernelThroughput {
  return {
    locations: wire.locations.map(toLocation),
    sampling: {
      stride: wire.meta.sample_stride,
      sampledRows: wire.meta.sampled_rows,
      sampledComputeSlots: wire.meta.sampled_compute_slots,
      sampledMemorySlots: wire.meta.sampled_memory_slots,
    },
    units: { tflops: 'TFLOP/s', gbps: 'GB/s' },
    definitions: { ...wire.definitions },
  };
}

export function decodeAnalyzerV1KernelThroughputPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): KernelThroughputDecodeResult {
  const unsupported = unsupportedV1Payload('kernel-throughput', input);
  if (unsupported) return { subject: 'kernelThroughput', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'kernelThroughput',
      ...incompatiblePayload('kernel-throughput', wireFormatIssues(input, parsed.error.issues), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return {
      subject: 'kernelThroughput',
      ...incompatiblePayload('kernel-throughput', [sourceIssue], 1),
    };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'kernelThroughput', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return {
      subject: 'kernelThroughput',
      ...incompatiblePayload('kernel-throughput', issues, 1),
    };
  }
  return {
    subject: 'kernelThroughput',
    status: 'ready',
    schemaVersion: 1,
    payload: toKernelThroughput(wire),
  };
}
