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
