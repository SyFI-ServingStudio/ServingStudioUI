export type ManagedJobKind = 'timing_predict' | 'kernel_profile' | 'kernel_measure';

export interface ManagedJobListItem {
  workspaceId: string;
  jobId: string;
  conversationId: string;
  conversationTitle: string;
  resourceId: string;
  analyzerResourceId: string | null;
  jobKind: ManagedJobKind;
  status: string;
  createdAt: number;
  updatedAt: number;
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jobFromWire(value: unknown): ManagedJobListItem | null {
  const source = recordFrom(value);
  const jobKind = source.job_kind;
  if (
    typeof source.workspace_id !== 'string' ||
    typeof source.job_id !== 'string' ||
    typeof source.conversation_id !== 'string' ||
    typeof source.conversation_title !== 'string' ||
    typeof source.resource_id !== 'string' ||
    (jobKind !== 'timing_predict' &&
      jobKind !== 'kernel_profile' &&
      jobKind !== 'kernel_measure') ||
    typeof source.status !== 'string' ||
    typeof source.created_at !== 'number' ||
    typeof source.updated_at !== 'number'
  ) {
    return null;
  }
  return {
    workspaceId: source.workspace_id,
    jobId: source.job_id,
    conversationId: source.conversation_id,
    conversationTitle: source.conversation_title,
    resourceId: source.resource_id,
    analyzerResourceId:
      typeof source.analyzer_resource_id === 'string' ? source.analyzer_resource_id : null,
    jobKind,
    status: source.status,
    createdAt: source.created_at,
    updatedAt: source.updated_at,
  };
}

export async function listManagedJobs(): Promise<readonly ManagedJobListItem[]> {
  const response = await fetch('/api/jobs');
  if (!response.ok) throw new Error(`List managed jobs failed (${response.status})`);
  const payload = recordFrom(await response.json());
  return Array.isArray(payload.jobs)
    ? payload.jobs.flatMap((value) => {
        const job = jobFromWire(value);
        return job ? [job] : [];
      })
    : [];
}
