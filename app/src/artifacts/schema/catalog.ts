/**
 * The six results catalogs.
 *
 * Each kind is served by its own endpoint with its own row shape and its own
 * way of saying "how far along is this". This module is where those six shapes
 * become one row type, and nothing above it needs to know that a run reports a
 * two-stage lifecycle while a prediction reports a free-form word.
 *
 * Everything here is a pure function of a parsed response body. The reads
 * themselves are in `../client.ts`, so every normalization decision below is
 * testable by handing it a literal.
 */
import { z } from 'zod';

import { resultIdSchema, resultKindSchema, type ResultKind } from '../../location';
import type { CatalogEntry, CatalogStatus } from '../ref';

const workspaceId = z.string().min(1);
const displayName = z.string().min(1);
/** Not `z.string().datetime()`: the offline kinds serve a timestamp the UI only
 * sorts and prints, and rejecting the whole list over its spelling would hide
 * every row for that kind. */
const timestamp = z.string().min(1);

const stage = z.enum(['not_started', 'pending', 'complete', 'failed']);

/**
 * Combine independent stages into one reportable status.
 *
 * `failed` outranks everything: a half that failed is the fact worth surfacing.
 * Then `complete`-and-`complete` is ready and `complete`-and-anything is
 * `partial` — an alignment with a finished kernel half is genuinely browsable,
 * and the Analyzer lifecycle already made that distinction for alignments.
 * Here it applies to runs too, which have the same two-stage structure.
 */
function combineStages(stages: readonly string[]): CatalogStatus {
  if (stages.some((value) => value === 'failed')) return 'failed';
  if (stages.every((value) => value === 'complete')) return 'ready';
  if (stages.some((value) => value === 'complete')) return 'partial';
  if (stages.some((value) => value === 'pending')) return 'pending';
  if (stages.every((value) => value === 'not_started')) return 'not_started';
  return 'unknown';
}

/**
 * A free-form status word from the offline kinds.
 *
 * Unrecognized words become `unknown` rather than being folded into `pending`.
 * An Analyzer that gains a status this build has not seen should say so, not be
 * paraphrased into a state the server never reported.
 */
function normalizeStatus(value: string): CatalogStatus {
  switch (value) {
    case 'complete':
    case 'ready':
      return 'ready';
    case 'partial':
      return 'partial';
    case 'pending':
    case 'running':
      return 'pending';
    case 'failed':
    case 'error':
      return 'failed';
    case 'not_started':
    case 'not started':
      return 'not_started';
    default:
      return 'unknown';
  }
}

const runRow = z.object({
  workspace_id: workspaceId,
  run_id: resultIdSchema,
  display_name: displayName,
  lifecycle: z.object({ simulation: stage, analysis: stage }),
  updated_at: timestamp,
});

const sweepRow = z.object({
  workspace_id: workspaceId,
  sweep_id: resultIdSchema,
  display_name: displayName,
  status: z.string(),
  updated_at: timestamp,
  num_runs: z.number().int().nonnegative(),
  deployments: z.array(z.string().min(1)),
  traces: z.array(z.string().min(1)),
  axes: z.array(z.string().min(1)),
  kind: z.enum(['sweep', 'singleton']),
});

/** The three offline kinds differ only in the name of their id field. */
const offlineRow = z.object({
  workspace_id: workspaceId,
  display_name: displayName,
  status: z.string(),
  updated_at: timestamp,
});

const predictionRow = offlineRow.extend({
  prediction_id: resultIdSchema,
  selector: z.string().min(1),
  gpu: z.string().min(1),
  case_count: z.number().int().nonnegative(),
});
const kernelOfflineFields = {
  kernel_kind: z.string().min(1),
  table: z.string().min(1),
  backend: z.string().min(1),
  gpu_observed_name: z.string().min(1).nullable(),
};
const profileRow = offlineRow.extend({ profile_id: resultIdSchema, ...kernelOfflineFields });
const measurementRow = offlineRow.extend({
  measurement_id: resultIdSchema,
  ...kernelOfflineFields,
});

const alignmentRow = z.object({
  workspace_id: workspaceId,
  alignment_id: resultIdSchema,
  display_name: displayName,
  kernel_analysis: z.string(),
  e2e_analysis: z.string(),
  updated_at: timestamp,
});

/**
 * How one kind's response body becomes rows.
 *
 * A table rather than six near-identical functions: the only things that vary
 * are the envelope key, the id field, and how the kind spells progress. Stating
 * just those three per kind is what keeps a seventh kind from arriving with its
 * own subtly different parse.
 */
interface KindSpec {
  /** The array's property name in the response envelope. */
  readonly envelope: string;
  /** Parse that array and normalize it. Takes `unknown` so the six specs share
   * one type; each is built by `spec()`, which keeps the row type inferred
   * inside. */
  readonly parse: (rows: unknown, kind: ResultKind) => CatalogEntry[];
}

/**
 * Build a `KindSpec` from a row schema and a row mapper.
 *
 * The generic is the point: `toEntry` sees the exact inferred row type of
 * `rowSchema`, so a mismatch between the schema and the field the mapper reads
 * is a compile error. Writing the table with a single erased row type instead
 * would need a cast per kind, and a cast is exactly where such a mismatch would
 * survive to runtime.
 */
function spec<T>(
  envelope: string,
  rowSchema: z.ZodType<T>,
  toEntry: (row: T, kind: ResultKind) => CatalogEntry,
): KindSpec {
  const rowsSchema = z.array(rowSchema);
  return {
    envelope,
    parse: (rows, kind) => rowsSchema.parse(rows).map((row) => toEntry(row, kind)),
  };
}

/** Shared shape of every row, whatever its id field is called. */
interface CommonRow {
  workspace_id: string;
  display_name: string;
  updated_at: string;
}

function entry(kind: ResultKind, row: CommonRow, id: string, status: CatalogStatus): CatalogEntry {
  return {
    kind,
    id,
    workspace: row.workspace_id,
    displayName: row.display_name,
    status,
    updatedAt: row.updated_at,
  };
}

const CATALOG_SPEC: Record<ResultKind, KindSpec> = {
  run: spec('runs', runRow, (row, kind) =>
    entry(kind, row, row.run_id, combineStages([row.lifecycle.simulation, row.lifecycle.analysis])),
  ),
  sweep: spec('sweeps', sweepRow, (row, kind) => ({
    ...entry(kind, row, row.sweep_id, normalizeStatus(row.status)),
    numRuns: row.num_runs,
    deployments: row.deployments,
    traces: row.traces,
    axes: row.kind === 'singleton' ? ['single run'] : row.axes,
  })),
  prediction: spec('predictions', predictionRow, (row, kind) => ({
    ...entry(kind, row, row.prediction_id, normalizeStatus(row.status)),
    caseCount: row.case_count,
    gpuName: row.gpu,
    selector: row.selector,
  })),
  alignment: spec('alignments', alignmentRow, (row, kind) => ({
    ...entry(kind, row, row.alignment_id, combineStages([row.kernel_analysis, row.e2e_analysis])),
    analysisHalves: [
      { name: 'kernel', status: row.kernel_analysis },
      { name: 'e2e', status: row.e2e_analysis },
    ],
  })),
  kernelProfile: spec('kernel_profiles', profileRow, (row, kind) => ({
    ...entry(kind, row, row.profile_id, normalizeStatus(row.status)),
    kernelKind: row.kernel_kind,
    table: row.table,
    backend: row.backend,
    ...(row.gpu_observed_name === null ? {} : { gpuName: row.gpu_observed_name }),
  })),
  kernelMeasurement: spec('kernel_measurements', measurementRow, (row, kind) => ({
    ...entry(kind, row, row.measurement_id, normalizeStatus(row.status)),
    kernelKind: row.kernel_kind,
    table: row.table,
    backend: row.backend,
    ...(row.gpu_observed_name === null ? {} : { gpuName: row.gpu_observed_name }),
  })),
};

/**
 * `protocol_version` is optional because three of the six endpoints have never
 * carried one. Where it is present it is checked; where it is absent this build
 * reads the body it knows how to read, which is what it has always done.
 */
const envelopeSchema = z
  .object({
    protocol_version: z.number().int().optional(),
    generated_at: z.string().optional(),
  })
  .passthrough();

export const CATALOG_PROTOCOL_VERSION = 1;

export interface CatalogParse {
  readonly value: readonly CatalogEntry[];
  readonly schemaVersion: number;
  /** `generated_at` where the endpoint serves one. It identifies the body well
   * enough to tell two reads apart, which is all a revision has to do until A2
   * makes the address itself revision-bearing. */
  readonly generatedAt: string | null;
}

export class IncompatibleCatalogError extends Error {
  readonly received: number;

  constructor(received: number) {
    super(
      `catalog was served as protocol version ${received}; this build reads ${CATALOG_PROTOCOL_VERSION}`,
    );
    this.name = 'IncompatibleCatalogError';
    this.received = received;
  }
}

/**
 * Parse one kind's catalog response.
 *
 * Throws `IncompatibleCatalogError` when the server declares a protocol this
 * build does not implement, and a `ZodError` when the body does not match. The
 * caller turns those into `incompatible` and `failed` respectively — two states
 * that need different words to the user, which is why they are two errors here
 * rather than one `null`.
 */
export function parseCatalog(of: ResultKind, body: unknown): CatalogParse {
  const envelope = envelopeSchema.parse(body);
  if (
    envelope.protocol_version !== undefined &&
    envelope.protocol_version !== CATALOG_PROTOCOL_VERSION
  ) {
    throw new IncompatibleCatalogError(envelope.protocol_version);
  }
  const kindSpec = CATALOG_SPEC[of];
  /** A kind an older Analyzer never publishes arrives as an absent key, not an
   * empty array. Reading that as "no results of this kind" is the truthful
   * answer and keeps one old deployment from emptying the whole page. */
  const rows = (envelope as Record<string, unknown>)[kindSpec.envelope] ?? [];
  return {
    value: inEnvelope(kindSpec.envelope, () => kindSpec.parse(rows, of)),
    schemaVersion: envelope.protocol_version ?? CATALOG_PROTOCOL_VERSION,
    generatedAt: envelope.generated_at ?? null,
  };
}

/**
 * Re-root a row-level issue path at the envelope key.
 *
 * The rows are parsed on their own, so zod reports `0.run_id` — a path that
 * does not exist in the response and does not say which of the six reads it
 * came from. Prefixing the envelope key makes the message name a field the
 * server and this build can actually be compared on: `runs.0.run_id`.
 */
function inEnvelope<T>(envelope: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new z.ZodError(
        error.issues.map((issue) => ({ ...issue, path: [envelope, ...issue.path] })),
      );
    }
    throw error;
  }
}

/**
 * Merge per-kind lists into the order the catalog shows.
 *
 * Newest first, ties broken by kind and then id so the list is a function of
 * its input alone. Without the tiebreak, two results sharing a timestamp — a
 * sweep and the runs it launched routinely do — would swap places between
 * renders purely on the order the six reads happened to settle.
 */
export function mergeCatalogs(lists: readonly (readonly CatalogEntry[])[]): CatalogEntry[] {
  const kindOrder = resultKindSchema.options;
  return lists.flat().sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1;
    if (left.kind !== right.kind) {
      return kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind);
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
