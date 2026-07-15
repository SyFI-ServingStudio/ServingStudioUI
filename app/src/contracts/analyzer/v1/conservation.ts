import { z } from 'zod';

import type { CheckStatus, Conservation } from '../../../domain/run';
import type { SubjectResult } from '../../../domain/subject';
import {
  duplicateKeyIssues,
  finiteNumber,
  formatZodIssue,
  incompatiblePayload,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const checkSchema = z.object({
  actual: finiteNumber,
  delta_pct: finiteNumber,
  description: z.string().trim().min(1),
  expected: finiteNumber,
  name: wireIdentityString,
  status: z.enum(['OK', 'WARN', 'FAIL']),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    all_ok: z.boolean(),
    available: z.literal(true),
    log_dir: wireIdentityString,
  }),
  checks: z.array(checkSchema),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  checks: z.array(z.unknown()).length(0),
});

const wireSchema = z.union([readySchema, unavailableSchema]);
type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return wire.meta.available === false;
}

export type ConservationDecodeResult =
  | Extract<SubjectResult<'conservation'>, { status: 'ready' }>
  | Extract<SubjectResult<'conservation'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'conservation'>, { status: 'incompatible' }>;

function checkStatus(status: ReadyWire['checks'][number]['status']): CheckStatus {
  if (status === 'OK') return 'ok';
  if (status === 'WARN') return 'warn';
  return 'fail';
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('checks', wire.checks, (check) => check.name);
  const computedAllOk = wire.checks.every((check) => check.status === 'OK');
  if (wire.meta.all_ok !== computedAllOk) {
    issues.push(`meta.all_ok: expected ${computedAllOk} from check statuses`);
  }
  return issues;
}

function toConservation(wire: ReadyWire): Conservation {
  return {
    allOk: wire.meta.all_ok,
    checks: wire.checks.map((check) => ({
      name: check.name,
      description: check.description,
      actual: check.actual,
      expected: check.expected,
      deltaPct: check.delta_pct,
      status: checkStatus(check.status),
    })),
  };
}

export function decodeAnalyzerV1ConservationPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): ConservationDecodeResult {
  const unsupported = unsupportedV1Payload('workload-conservation', input);
  if (unsupported) return { subject: 'conservation', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'conservation',
      ...incompatiblePayload('workload-conservation', parsed.error.issues.map(formatZodIssue), 1),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return {
      subject: 'conservation',
      ...incompatiblePayload('workload-conservation', [sourceIssue], 1),
    };
  }
  const wire = parsed.data;
  if (isUnavailable(wire)) {
    return { subject: 'conservation', status: 'unavailable', reason: wire.meta.reason };
  }
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    return {
      subject: 'conservation',
      ...incompatiblePayload('workload-conservation', issues, 1),
    };
  }
  return {
    subject: 'conservation',
    status: 'ready',
    schemaVersion: 1,
    payload: toConservation(wire),
  };
}
