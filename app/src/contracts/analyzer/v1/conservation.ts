import { z } from 'zod';

import type { CheckStatus, Conservation } from '../../../domain/run';
import { duplicateKeyIssues, finiteNumber, wireIdentityString } from './subjectDecode';
import {
  defineAnalyzerV1PayloadDecoder,
  type AnalyzerV1PayloadDecodeResult,
} from './subjectEnvelope';

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

type ReadyWire = z.infer<typeof readySchema>;

export type ConservationDecodeResult = AnalyzerV1PayloadDecodeResult<'conservation'>;

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

export const decodeAnalyzerV1ConservationPayload = defineAnalyzerV1PayloadDecoder({
  subject: 'conservation',
  label: 'workload-conservation',
  readySchema,
  unavailableSchema,
  semanticIssues,
  toPayload: toConservation,
});
