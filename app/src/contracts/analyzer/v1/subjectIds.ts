import type { SubjectName } from '../../../domain/subject';

/** Wire identifiers are current analyzer registry tokens plus explicitly
 * reserved future subject ids. Never infer domain names from filenames. */
export const ANALYZER_V1_SUBJECT_TO_DOMAIN = {
  'slo-general': 'slo',
  throughput: 'throughput',
  utilization: 'utilization',
  'kv-occupancy': 'kv',
  // Reserved until the analyzer publishes bounded timeline artifacts.
  concurrency: 'concurrency',
  backpressure: 'backpressure',
  batch: 'batch',
  'kernel-throughput': 'kernelThroughput',
  'workload-conservation': 'conservation',
  'kernel-input-distribution': 'kernelInputDistribution',
  'kernel-time-share': 'kernelTimeShare',
} as const satisfies Readonly<Record<string, SubjectName>>;

export type AnalyzerV1MappedSubjectId = keyof typeof ANALYZER_V1_SUBJECT_TO_DOMAIN;

export function domainSubjectName(subjectId: string): SubjectName | undefined {
  if (!Object.prototype.hasOwnProperty.call(ANALYZER_V1_SUBJECT_TO_DOMAIN, subjectId)) {
    return undefined;
  }
  return ANALYZER_V1_SUBJECT_TO_DOMAIN[subjectId as AnalyzerV1MappedSubjectId];
}
