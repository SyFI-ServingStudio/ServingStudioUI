/** Project the current canonical Location into the Agent's frozen v2 turn context. */
import type { AnalyzerSelectionV2 } from '../session/analyzerContext';
import type { SweepAnalysis } from '../artifacts/schema/sweep';
import { segmentOf, type Location } from '../location';
import type { AgentSelectionContext } from '../panels/conversation/AgentComposer';
import { analyzerTurnContext } from './citationDictionary';

export interface AgentLocationContext {
  /** Matches the legacy clear-selection boundary: the complete turn attachment. */
  readonly identity: string;
  readonly selection: AnalyzerSelectionV2;
  readonly display: AgentSelectionContext;
  readonly turn: Readonly<Record<string, unknown>>;
}

function runSelection(
  location: Extract<Location, { view: 'result' }>,
): Extract<AnalyzerSelectionV2, { kind: 'run' }> {
  const pool = segmentOf(location.focus.path, 'pool');
  const worker = segmentOf(location.focus.path, 'worker');
  const operation = segmentOf(location.focus.path, 'operation');
  const leaf = segmentOf(location.focus.path, 'leaf');
  const parallel = segmentOf(location.focus.path, 'parallel');
  const scope =
    leaf !== null
      ? 'kernel'
      : parallel !== null
        ? 'parallel'
        : worker !== null
          ? 'worker'
          : pool !== null
            ? 'pool'
            : 'cluster';
  return {
    kind: 'run',
    workspaceId: location.ref.workspace,
    runId: location.ref.id,
    // A card selected inside the complete analysis page is independent from
    // `panel`, which names the standalone-panel/page-mode route.
    panelId: location.focus.options['evidence-panel'] ?? location.focus.panel,
    scope,
    poolRole: pool?.role ?? null,
    workerKey:
      pool === null || worker === null
        ? null
        : `${encodeURIComponent(pool.role)}/${encodeURIComponent(worker.id)}`,
    leafId: leaf?.id ?? null,
    parId: parallel?.id ?? null,
    cursorMs: location.focus.cursorMs,
    cursorNeedsSeek: false,
    operation:
      operation === null
        ? null
        : { iterId: operation.iter, batchId: operation.batch, operationId: operation.op },
    workerAnalysisLevel:
      location.focus.panel === 'worker.cost-tree' || operation !== null ? 'iteration' : 'worker',
  };
}

function selectionFromLocation(
  location: Extract<Location, { view: 'result' }>,
): AnalyzerSelectionV2 | null {
  const panelId = location.focus.panel;
  switch (location.ref.kind) {
    case 'run':
      return runSelection(location);
    case 'sweep': {
      const run = segmentOf(location.focus.path, 'run');
      const evidencePanel = location.focus.options['evidence-panel'];
      return {
        kind: 'aggregate',
        workspaceId: location.ref.workspace,
        experimentId: location.ref.id,
        ...(evidencePanel ? { panelId: evidencePanel } : {}),
        ...(location.focus.options.metric ? { metricKey: location.focus.options.metric } : {}),
        ...(location.focus.options.stat === 'mean' || location.focus.options.stat === 'p99'
          ? { statistic: location.focus.options.stat }
          : {}),
        ...(run?.id === undefined ? {} : { runId: run.id }),
        ...(run?.coordinates === undefined ? {} : { coordinates: run.coordinates }),
      };
    }
    case 'prediction': {
      const predictionCase = segmentOf(location.focus.path, 'case');
      const operation = segmentOf(location.focus.path, 'caseOperation');
      const leaf = segmentOf(location.focus.path, 'leaf');
      const parallel = segmentOf(location.focus.path, 'parallel');
      return {
        kind: 'prediction',
        workspaceId: location.ref.workspace,
        predictionId: location.ref.id,
        panelId,
        caseId: predictionCase?.id ?? null,
        operationId: operation?.id ?? null,
        leafId: leaf?.id ?? null,
        parallelId: parallel?.id ?? null,
        optimalityMode:
          location.focus.options.optimality === 'batch_locked' ? 'batch_locked' : 'unlocked',
      };
    }
    case 'kernelProfile':
      return {
        kind: 'kernel_profile',
        workspaceId: location.ref.workspace,
        profileId: location.ref.id,
        panelId,
        metricKey: location.focus.options.metric ?? null,
      };
    case 'kernelMeasurement':
      return {
        kind: 'kernel_measurement',
        workspaceId: location.ref.workspace,
        measurementId: location.ref.id,
        panelId,
        metricKey: location.focus.options.metric ?? null,
        plotName: location.focus.options.plot ?? null,
      };
    case 'alignment':
      return null;
  }
}

function contextValues(selection: AnalyzerSelectionV2): readonly string[] {
  if (selection.kind === 'aggregate') {
    return [
      'aggregate',
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey && selection.metricKey !== selection.panelId
        ? [selection.metricKey]
        : []),
      ...(selection.statistic ? [selection.statistic] : []),
      ...Object.entries(selection.coordinates ?? {}).map(
        ([axis, value]) => `${axis}=${Array.isArray(value) ? value.join('+') : String(value)}`,
      ),
    ];
  }
  if (selection.kind === 'prediction') {
    return [
      'prediction',
      selection.predictionId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.caseId ? [`case=${selection.caseId}`] : []),
      ...(selection.operationId ? [`operation=${selection.operationId}`] : []),
      ...(selection.leafId !== null ? [`kernel=${selection.leafId}`] : []),
      ...(selection.parallelId !== null ? [`parallel=${selection.parallelId}`] : []),
      `optimality=${selection.optimalityMode}`,
    ];
  }
  if (selection.kind === 'kernel_profile') {
    return [
      'kernel profile',
      selection.profileId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey ? [selection.metricKey] : []),
    ];
  }
  if (selection.kind === 'kernel_measurement') {
    return [
      'kernel measurement',
      selection.measurementId,
      ...(selection.panelId ? [selection.panelId] : []),
      ...(selection.metricKey ? [selection.metricKey] : []),
      ...(selection.plotName ? [selection.plotName] : []),
    ];
  }
  return [
    'run',
    ...(selection.panelId ? [selection.panelId] : []),
    selection.scope,
    ...(selection.poolRole ? [`pool=${selection.poolRole}`] : []),
    ...(selection.workerKey ? [`worker=${selection.workerKey}`] : []),
    ...(selection.leafId !== null ? [`kernel=${selection.leafId}`] : []),
    ...(selection.parId !== null ? [`parallel=${selection.parId}`] : []),
  ];
}

export function agentContext(
  location: Location,
  sweepAnalysis?: SweepAnalysis,
): AgentLocationContext | null {
  if (location.view !== 'result') return null;
  const selection = selectionFromLocation(location);
  if (selection === null) return null;
  const turn = analyzerTurnContext(selection, sweepAnalysis);
  if (turn === null) return null;
  const selectionIdentity = JSON.stringify(selection);
  return {
    identity: JSON.stringify(turn),
    selection,
    display: {
      present: true,
      identity: selectionIdentity,
      values: contextValues(selection),
      json: JSON.stringify(selection, null, 2),
    },
    turn,
  };
}
