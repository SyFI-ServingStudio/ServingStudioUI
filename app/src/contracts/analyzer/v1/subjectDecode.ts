import { z, type ZodIssue } from 'zod';

export const wireIdentityString = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'must contain a non-whitespace character',
  });
export const finiteNumber = z.number().finite();
export const nonNegativeNumber = finiteNumber.nonnegative();
export const nonNegativeCount = z.number().int().nonnegative().safe();
export const positiveCount = nonNegativeCount.positive();

export interface AnalyzerV1PayloadDecodeOptions {
  /** Exact simulator-owned source id recorded in payload meta.log_dir. */
  expectedLogDir?: string;
}

export interface IncompatiblePayload {
  status: 'incompatible';
  reason: string;
  receivedSchemaVersion?: number;
}

export function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
  return `${path}: ${issue.message}`;
}

export function receivedSchemaVersion(input: unknown): number | undefined {
  if (typeof input !== 'object' || input === null || !('schema_version' in input)) return undefined;
  const version = (input as { schema_version?: unknown }).schema_version;
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

export function incompatiblePayload(
  label: string,
  issues: readonly string[],
  receivedVersion?: number,
): IncompatiblePayload {
  return {
    status: 'incompatible',
    reason: `Invalid analyzer-v1 ${label} payload:\n${issues
      .map((issue) => `- ${issue}`)
      .join('\n')}`,
    ...(receivedVersion === undefined ? {} : { receivedSchemaVersion: receivedVersion }),
  };
}

export function unsupportedV1Payload(
  label: string,
  input: unknown,
): IncompatiblePayload | undefined {
  const version = receivedSchemaVersion(input);
  return version !== undefined && version !== 1
    ? incompatiblePayload(
        label,
        [`schema_version: unsupported version ${version}; expected 1`],
        version,
      )
    : undefined;
}

export function sourceLogDirIssue(
  actualLogDir: string,
  options: AnalyzerV1PayloadDecodeOptions,
): string | undefined {
  return options.expectedLogDir !== undefined && actualLogDir !== options.expectedLogDir
    ? `meta.log_dir: payload belongs to ${actualLogDir}, expected ${options.expectedLogDir}`
    : undefined;
}

export function parallelLengthIssue(
  path: string,
  expectedLength: number,
  values: readonly unknown[],
): string | undefined {
  return values.length === expectedLength
    ? undefined
    : `${path}: has ${values.length} points, expected ${expectedLength}`;
}

export function duplicateKeyIssues<T>(
  path: string,
  rows: readonly T[],
  keyOf: (row: T) => string,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const key = keyOf(row);
    if (seen.has(key)) issues.push(`${path}.${index}: duplicate key ${key}`);
    seen.add(key);
  });
  return issues;
}

export function nonDecreasingIssue(path: string, values: readonly number[]): string | undefined {
  const badIndex = values.findIndex((value, index) => index > 0 && value < values[index - 1]);
  return badIndex < 0 ? undefined : `${path}.${badIndex}: values must be non-decreasing`;
}
