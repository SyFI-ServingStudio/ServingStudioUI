export type SweepStatus = 'ready' | 'pending';
export type SweepPrimitive = string | number | boolean | null;
export type SweepCoordinateValue = SweepPrimitive | readonly SweepPrimitive[];

export interface SweepListItem {
  workspaceId: string;
  sweepId: string;
  kind: 'sweep' | 'singleton';
  displayName: string;
  axes: readonly string[];
  numRuns: number;
  status: SweepStatus;
  experimentDate: string | null;
  deployments: readonly string[];
  traces: readonly string[];
  updatedAt: string;
}

export interface SweepMetric {
  key: string;
  label: string;
  group: string;
  unit: string;
  objective: 'minimize' | 'maximize';
}

export interface SweepRun {
  runId: string | null;
  coordinates: Readonly<Record<string, SweepCoordinateValue>>;
  labels: Readonly<Record<string, string>>;
  lifecycle: {
    simulation: 'not_started' | 'pending' | 'complete' | 'failed';
    analysis: 'not_started' | 'pending' | 'complete' | 'failed';
  };
  metrics: Readonly<Record<string, number | null>>;
}

export interface SweepAnalysis {
  protocolVersion: 1;
  schemaVersion: 1;
  workspaceId: string;
  sweepId: string;
  displayName: string;
  axes: readonly string[];
  domains: Readonly<Record<string, readonly SweepCoordinateValue[]>>;
  metrics: readonly SweepMetric[];
  runs: readonly SweepRun[];
  definitions: Readonly<Record<string, string>>;
}
