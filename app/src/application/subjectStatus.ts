import type { SubjectName, SubjectResult } from '../domain/subject';

const STATUS_LABELS = {
  pending: 'loading',
  unavailable: 'unavailable',
  not_generated: 'not generated',
  failed: 'failed',
  incompatible: 'incompatible',
} as const;

type NonReadySubjectResult = Exclude<SubjectResult<SubjectName>, { status: 'ready' }>;

/** Shared wording for local subject boundaries. A ready-but-empty payload is
 * deliberately handled by its chart projection, not as an availability error. */
export function subjectStatusLabel(result: NonReadySubjectResult): string {
  return STATUS_LABELS[result.status];
}

export function subjectStatusMessage(result: NonReadySubjectResult): string {
  const fallback = `Analyzer subject ${result.subject} is ${subjectStatusLabel(result)}.`;
  const reason = 'reason' in result ? result.reason : undefined;
  const code = 'code' in result ? result.code : undefined;
  return [fallback, code ? `[${code}]` : '', reason ?? ''].filter(Boolean).join(' ');
}
