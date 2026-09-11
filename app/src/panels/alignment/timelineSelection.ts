import type { HostLaneCensus, HostLaneKey, HostLaneRow } from './hostLanes';
import type { ContinuousScene, LaneBar } from './timelineGeometry';

export type TimelineTraceKind = 'api' | 'kernel' | 'simulation';

/** One selectable occurrence in the measured/modelled stack. */
export interface TimelineTrace {
  readonly id: string;
  readonly kind: TimelineTraceKind;
  readonly iterationId: number | null;
  readonly label: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly correlationId: number | null;
  readonly operation: string | null;
  readonly rowId: string | null;
  readonly phase: string | null;
  readonly slotIndex: number | null;
  readonly slotKind: string | null;
  readonly row: number;
  readonly apiClassIndex: number | null;
  readonly laneKey: string;
}

export interface TimelineTraceConnection {
  readonly kernel: TimelineTrace;
  readonly simulation: TimelineTrace | null;
  readonly api: TimelineTrace | null;
}

export function traceFromBar(bar: LaneBar, kind: TimelineTraceKind): TimelineTrace {
  return {
    id: bar.id,
    kind,
    iterationId: bar.iterationId,
    label: bar.label,
    startMs: bar.startMs,
    endMs: bar.endMs,
    correlationId: bar.correlationId,
    operation: bar.operation,
    rowId: bar.rowId,
    phase: bar.phase,
    slotIndex: bar.slotIndex,
    slotKind: bar.slotKind,
    row: bar.row,
    apiClassIndex: null,
    laneKey: kind === 'kernel' ? 'measured' : 'simulation',
  };
}

export function traceFromApi(row: HostLaneRow, laneKey: HostLaneKey): TimelineTrace {
  return {
    id: row.id,
    kind: 'api',
    iterationId: null,
    label: row.label,
    startMs: row.startMs,
    endMs: row.endMs,
    correlationId: row.correlationId,
    operation: null,
    rowId: null,
    phase: null,
    slotIndex: null,
    slotKind: null,
    row: row.depth,
    apiClassIndex: row.apiClassIndex,
    laneKey,
  };
}

function barsForIteration(
  scene: ContinuousScene,
  iterationId: number,
): { readonly measured: readonly LaneBar[]; readonly simulated: readonly LaneBar[] } | null {
  const lane = scene.lanes.find((candidate) => candidate.iterationId === iterationId);
  return lane === undefined ? null : { measured: lane.measured, simulated: lane.simulated };
}

/**
 * The modelled lane is not a second timestamp source. Its only durable join to
 * a measured kernel is the analyzer's operation mapping, within one iteration.
 * A CUDA runtime launch joins to a measured kernel only through NSYS's
 * correlation id; time proximity is never used for either relationship.
 */
export function traceConnections(
  trace: TimelineTrace | null,
  scene: ContinuousScene,
  host: HostLaneCensus | null = null,
): readonly TimelineTraceConnection[] {
  if (trace === null) return [];
  if (trace.kind === 'api') {
    if (trace.correlationId === null) return [];
    const kernel = kernelForCorrelation(scene, trace.correlationId);
    return kernel === null ? [] : [connectionForKernel(kernel, scene, host, trace)];
  }
  if (trace.iterationId === null || trace.operation === null) return [];
  const bars = barsForIteration(scene, trace.iterationId);
  if (bars === null) return [];
  const operation = trace.operation;
  const measured = bars.measured.filter((bar) => bar.operation === operation);
  const simulated = bars.simulated.filter((bar) => bar.operation === operation);
  const selectedBars = trace.kind === 'kernel' ? measured : simulated;
  const selectedIndex = selectedBars.findIndex((bar) => bar.id === trace.id);
  if (selectedIndex < 0) return [];

  // One operation may repeat many times in a cycle. The analyzer does not
  // expose a cross-lane occurrence id, so pair the Nth measured occurrence
  // with the Nth modelled occurrence in their own lane order. This is a strict
  // one-to-one ordinal join, never a nearest-time or one-to-many highlight.
  const kernel =
    trace.kind === 'kernel'
      ? trace
      : measured[selectedIndex] === undefined
        ? null
        : traceFromBar(measured[selectedIndex], 'kernel');
  return kernel === null ? [] : [connectionForKernel(kernel, scene, host)];
}

function connectionForKernel(
  kernel: TimelineTrace,
  scene: ContinuousScene,
  host: HostLaneCensus | null,
  selectedApi: TimelineTrace | null = null,
): TimelineTraceConnection {
  return {
    kernel,
    simulation: simulationForKernel(kernel, scene),
    api: selectedApi ?? apiForCorrelation(host, kernel.correlationId),
  };
}

function simulationForKernel(kernel: TimelineTrace, scene: ContinuousScene): TimelineTrace | null {
  if (kernel.iterationId === null || kernel.operation === null) return null;
  const bars = barsForIteration(scene, kernel.iterationId);
  if (bars === null) return null;
  const measured = bars.measured.filter((bar) => bar.operation === kernel.operation);
  const simulated = bars.simulated.filter((bar) => bar.operation === kernel.operation);
  const measuredIndex = measured.findIndex((bar) => bar.id === kernel.id);
  const simulationBar = measuredIndex < 0 ? undefined : simulated[measuredIndex];
  return simulationBar === undefined ? null : traceFromBar(simulationBar, 'simulation');
}

function kernelForCorrelation(scene: ContinuousScene, correlationId: number): TimelineTrace | null {
  for (const lane of scene.lanes) {
    const bar = lane.measured.find((candidate) => candidate.correlationId === correlationId);
    if (bar !== undefined) return traceFromBar(bar, 'kernel');
  }
  return null;
}

function apiForCorrelation(
  host: HostLaneCensus | null,
  correlationId: number | null,
): TimelineTrace | null {
  if (correlationId === null) return null;
  const match = apiRows(host).find(({ row }) => row.correlationId === correlationId);
  return match === undefined ? null : traceFromApi(match.row, match.laneKey);
}

export function apiRows(
  host: HostLaneCensus | null,
): readonly { readonly laneKey: HostLaneKey; readonly row: HostLaneRow }[] {
  if (host === null) return [];
  return host.lanes
    .filter((lane) => lane.kind === 'api')
    .flatMap((lane) => lane.rows.map((row) => ({ laneKey: lane.key, row })));
}

export function connectedTraceIds(
  trace: TimelineTrace | null,
  scene: ContinuousScene,
  host: HostLaneCensus | null = null,
): ReadonlySet<string> {
  if (trace === null) return new Set();
  const ids = new Set<string>([trace.id]);
  for (const connection of traceConnections(trace, scene, host)) {
    ids.add(connection.kernel.id);
    if (connection.simulation !== null) ids.add(connection.simulation.id);
    if (connection.api !== null) ids.add(connection.api.id);
  }
  return ids;
}
