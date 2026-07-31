export interface KernelProfileAxis {
  key: string;
  values: readonly unknown[];
}

export interface KernelProfileSeries {
  metric: string;
  unit: string;
  lowerIsBetter: boolean;
}

export interface KernelProfileRow {
  index: number;
  coordinates: Record<string, unknown>;
  args: Record<string, unknown>;
  status: string;
  metrics: Record<string, unknown> | null;
}

export interface KernelProfileCurve {
  schemaVersion: 1;
  resourceKind: 'kernel_profile_curve';
  kernelKind: string;
  table: string;
  backend: string;
  metricFamily: string;
  axes: readonly KernelProfileAxis[];
  fixedArgs: Record<string, unknown>;
  layout: { xAxis: string | null; yAxis: string | null; facets: readonly string[] };
  series: readonly KernelProfileSeries[];
  rows: readonly KernelProfileRow[];
}

export interface ManagedJobResource {
  schemaVersion: 1;
  workspaceId: string;
  jobId: string;
  resourceId: string;
  jobKind: 'timing_predict' | 'kernel_profile' | 'kernel_measure';
  status: string;
  artifactPath: string;
  descriptor: Record<string, unknown>;
  summary: Record<string, unknown> | null;
  files: readonly string[];
  curve: KernelProfileCurve | null;
  iterBreakdown: string | null;
}

export type ManagedJobKind = ManagedJobResource['jobKind'];

export interface ManagedJobListItem {
  workspaceId: string;
  jobId: string;
  conversationId: string;
  conversationTitle: string;
  resourceId: string;
  jobKind: ManagedJobKind;
  status: string;
  artifactPath: string;
  descriptor: Record<string, unknown>;
  summary: Record<string, unknown> | null;
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
    typeof source.artifact_path !== 'string' ||
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
    jobKind,
    status: source.status,
    artifactPath: source.artifact_path,
    descriptor: recordFrom(source.descriptor),
    summary: source.summary === null ? null : recordFrom(source.summary),
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

export async function getManagedJobResource(
  workspaceId: string,
  resourceId: string,
): Promise<ManagedJobResource> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(resourceId)}`,
  );
  if (!response.ok) throw new Error(`Load job result failed (${response.status})`);
  return (await response.json()) as ManagedJobResource;
}

export function managedJobArtifactUrl(
  workspaceId: string,
  resourceId: string,
  path: string,
): string {
  const query = new URLSearchParams({ path });
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/jobs/${encodeURIComponent(resourceId)}/artifact?${query.toString()}`;
}
