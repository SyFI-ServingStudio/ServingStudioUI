import { useQuery } from '@tanstack/react-query';

import type { SubjectName } from '../domain/subject';
import { useAnalyzerRepository } from './RepositoryProvider';

export const analyzerQueryKeys = {
  all: ['analyzer'] as const,
  runs: () => [...analyzerQueryKeys.all, 'runs'] as const,
  descriptor: (runId: string) => [...analyzerQueryKeys.runs(), runId, 'descriptor'] as const,
  subject: (runId: string, subject: string) => [...analyzerQueryKeys.runs(), runId, 'subject', subject] as const,
};

export function useRunListQuery() {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.runs(),
    queryFn: () => repository.listRuns(),
  });
}

export function useRunDescriptorQuery(runId: string) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.descriptor(runId),
    queryFn: () => repository.getRunDescriptor(runId),
    enabled: runId.length > 0,
  });
}

export function useSubjectQuery<Name extends SubjectName>(runId: string, subject: Name) {
  const repository = useAnalyzerRepository();
  return useQuery({
    queryKey: analyzerQueryKeys.subject(runId, subject),
    queryFn: () => repository.getSubject(runId, subject),
    enabled: runId.length > 0,
  });
}
