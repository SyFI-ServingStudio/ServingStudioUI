/**
 * The model configuration a run was given.
 *
 * `config` is another project's file — a Hugging Face `config.json`, whose keys
 * differ per architecture — and it is kept as the raw map for that reason.
 * Narrowing it here would mean maintaining a union of every architecture the
 * simulator can load, and being wrong about a new one by refusing to read it at
 * all. Readers take the two or three keys they know by name and cope with
 * absence, which is what they would have to do anyway.
 *
 * What *is* checked is the envelope: the version, and that `config` is an
 * object rather than a string or a list. A caller indexing into a string gets
 * `undefined` for every key and shows a page of blanks.
 */
import { z } from 'zod';

import type { ModelParameterCounts, RunModel } from '../ref';

export const RUN_MODEL_SCHEMA_VERSION = 2;

export class IncompatibleRunModelError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(`model payload is not readable:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'IncompatibleRunModelError';
  }
}

const counts = z
  .object({
    total: z.number().finite().nonnegative(),
    active: z.number().finite().nonnegative(),
  })
  .passthrough();

const modelSchema = z
  .object({
    schema_version: z.number(),
    source_path: z.string().min(1),
    config: z.record(z.unknown()),
    parameter_counts: counts.optional(),
  })
  .passthrough();

function runModelVersion(body: unknown): number | undefined {
  const version = (body as { schema_version?: unknown } | null)?.schema_version;
  return typeof version === 'number' ? version : undefined;
}

export function parseRunModel(body: unknown): RunModel {
  const version = runModelVersion(body);
  if (version !== undefined && version !== RUN_MODEL_SCHEMA_VERSION) {
    throw new IncompatibleRunModelError(
      [`schema_version ${version} is not ${RUN_MODEL_SCHEMA_VERSION}`],
      version,
    );
  }
  const parsed = modelSchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleRunModelError(
      parsed.error.issues.map(
        (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
      ),
      version,
    );
  }
  const parameters: ModelParameterCounts | undefined =
    parsed.data.parameter_counts === undefined
      ? undefined
      : { total: parsed.data.parameter_counts.total, active: parsed.data.parameter_counts.active };
  return {
    sourcePath: parsed.data.source_path,
    config: parsed.data.config,
    parameters,
  };
}

/**
 * One number out of the config, by name.
 *
 * Here rather than at each call site because "the key is missing", "the key
 * holds a string" and "the key holds NaN" are all the same answer to the
 * reader — the run did not say — and three call sites would spell that answer
 * three ways.
 */
export function modelNumber(model: RunModel | undefined, key: string): number | undefined {
  const value = model?.config[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
