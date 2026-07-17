import type { SubjectName, SubjectResult } from '../../../domain/subject';
import { decodeAnalyzerV1BatchPayload } from './batch';
import { decodeAnalyzerV1ConservationPayload } from './conservation';
import { decodeAnalyzerV1ConcurrencyPayload } from './concurrency';
import { decodeAnalyzerV1KernelThroughputPayload } from './kernelThroughput';
import { decodeAnalyzerV1KernelInputDistributionPayload } from './kernelInputDistribution';
import { decodeAnalyzerV1KernelTimeSharePayload } from './kernelTimeShare';
import { decodeAnalyzerV1KvOccupancyPayload } from './kvOccupancy';
import { decodeAnalyzerV1SloPayload } from './slo';
import type { AnalyzerV1PayloadDecodeOptions } from './subjectDecode';
import { decodeAnalyzerV1ThroughputPayload } from './throughput';
import { decodeAnalyzerV1UtilizationPayload } from './utilization';

function unsupportedReadySubject<Name extends SubjectName>(subject: Name): SubjectResult<Name> {
  return {
    subject,
    status: 'incompatible',
    reason: `Analyzer-v1 ${subject} is marked ready, but this UI has no safe payload adapter for it.`,
  } as SubjectResult<Name>;
}

/** Explicit domain-name dispatch for ready analyzer-v1 payloads. Wire subject
 * tokens are mapped by subjectIds.ts before this boundary; filenames never
 * select a decoder. Subjects without a safe ready adapter fail locally. */
export function decodeAnalyzerV1SubjectPayload<Name extends SubjectName>(
  subject: Name,
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): SubjectResult<Name> {
  switch (subject) {
    case 'slo':
      return decodeAnalyzerV1SloPayload(input, options) as SubjectResult<Name>;
    case 'throughput':
      return decodeAnalyzerV1ThroughputPayload(input, options) as SubjectResult<Name>;
    case 'utilization':
      return decodeAnalyzerV1UtilizationPayload(input, options) as SubjectResult<Name>;
    case 'kv':
      return decodeAnalyzerV1KvOccupancyPayload(input, options) as SubjectResult<Name>;
    case 'batch':
      return decodeAnalyzerV1BatchPayload(input, options) as SubjectResult<Name>;
    case 'kernelThroughput':
      return decodeAnalyzerV1KernelThroughputPayload(input, options) as SubjectResult<Name>;
    case 'conservation':
      return decodeAnalyzerV1ConservationPayload(input, options) as SubjectResult<Name>;
    case 'concurrency':
      return decodeAnalyzerV1ConcurrencyPayload(input, options) as SubjectResult<Name>;
    case 'kernelTimeShare':
      return decodeAnalyzerV1KernelTimeSharePayload(input, options) as SubjectResult<Name>;
    case 'kernelInputDistribution':
      return decodeAnalyzerV1KernelInputDistributionPayload(input, options) as SubjectResult<Name>;
    case 'backpressure':
      return unsupportedReadySubject(subject) as SubjectResult<Name>;
  }
}
