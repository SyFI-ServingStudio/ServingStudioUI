import { describe, expect, it } from 'vitest';

import type { HostLaneCensus } from './hostLanes';
import type { ContinuousScene, LaneBar } from './timelineGeometry';
import {
  connectedTraceIds,
  traceConnections,
  traceFromApi,
  traceFromBar,
} from './timelineSelection';

const bar = (id: string, kind: 'kernel' | 'simulation', startMs: number): LaneBar => ({
  id,
  iterationId: 17,
  startMs,
  endMs: startMs + 1,
  correlationId: kind === 'kernel' && id === 'kernel-0' ? 101 : null,
  label: `${kind}-${id}`,
  operation: 'layer.attention',
  color: '#000',
  phase: kind === 'kernel' ? 'forward' : null,
  rowId: kind === 'kernel' ? `row-${id}` : null,
  slotIndex: kind === 'simulation' ? Number(id) : null,
  slotKind: kind === 'simulation' ? 'attention' : null,
  row: 0,
});

const measured = [bar('kernel-0', 'kernel', 0), bar('kernel-1', 'kernel', 2)];
const simulated = [bar('simulation-0', 'simulation', 0), bar('simulation-1', 'simulation', 2)];
const scene: ContinuousScene = {
  startMs: 0,
  endMs: 4,
  lanes: [
    {
      role: 'selected',
      iterationId: 17,
      iterationType: 'decode',
      offsetMs: 0,
      kernelEndMs: 4,
      measured,
      simulated,
      simulatedRowCount: 1,
      gaps: [],
      phaseBands: [],
      simulatedGpuCycleEndMs: 3,
      spanMs: 4,
      criticalPathMs: 4,
      simulatedMs: 3,
      idleFraction: 0,
      forwardIdleFraction: 0,
      gapCount: 0,
    },
  ],
  interIterationGaps: [],
  phaseOrder: [],
  selectedIndex: 0,
};

const host: HostLaneCensus = {
  lanes: [
    {
      key: 'workerApi',
      label: '└ cuda api',
      kind: 'api',
      rows: [
        {
          id: 'api-0',
          startMs: -0.2,
          endMs: -0.1,
          label: 'cudaLaunchKernel',
          depth: 0,
          apiClassIndex: 0,
          correlationId: 101,
        },
      ],
    },
  ],
  nvtxMarks: 0,
  deeperMarks: 0,
  offAxisRows: 0,
  apiTotals: [],
  hiddenThreadRoles: [],
  hiddenThreadCount: 0,
  source: 'test',
  windowRule: 'test',
  ownershipRule: 'test',
};

describe('timeline selection', () => {
  it('pairs repeated operation occurrences one-to-one by lane order', () => {
    const firstKernel = traceFromBar(measured[0], 'kernel');
    const secondKernel = traceFromBar(measured[1], 'kernel');

    expect(
      traceConnections(firstKernel, scene).map((connection) => connection.simulation?.id),
    ).toEqual(['simulation-0']);
    expect(
      traceConnections(secondKernel, scene).map((connection) => connection.simulation?.id),
    ).toEqual(['simulation-1']);
  });

  it('only highlights the selected occurrence and its one counterpart', () => {
    const ids = connectedTraceIds(traceFromBar(measured[0], 'kernel'), scene);
    expect([...ids]).toEqual(['kernel-0', 'simulation-0']);
  });

  it('connects a CUDA launch to its kernel by NSYS correlation id', () => {
    const launch = traceFromApi(host.lanes[0].rows[0], 'workerApi');
    const connections = traceConnections(launch, scene, host);

    expect(connections).toHaveLength(1);
    expect(connections[0].kernel.id).toBe('kernel-0');
    expect(connections[0].simulation?.id).toBe('simulation-0');
    expect(connections[0].api?.id).toBe('api-0');
    expect([...connectedTraceIds(launch, scene, host)]).toEqual([
      'api-0',
      'kernel-0',
      'simulation-0',
    ]);
  });
});
