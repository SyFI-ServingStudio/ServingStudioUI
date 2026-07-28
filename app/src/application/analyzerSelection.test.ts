import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkerKey } from '../domain/worker';
import { useViz } from '../store';
import {
  ANALYZER_SELECTION_CHANGE_EVENT,
  analyzerSelectionFromVizState,
  inquiryContextFromVizState,
  installAnalyzerSelectionPublisher,
} from './analyzerSelection';

beforeEach(() => {
  useViz.setState({
    selectionSurface: 'aggregate',
    aggregateSelection: null,
    inquiryId: null,
    phaseId: null,
    runWorkspaceId: null,
    runId: null,
    runPanelId: null,
    scope: 'cluster',
    poolRole: null,
    workerKey: null,
    leafId: null,
    parId: null,
    cursorMs: null,
    cursorNeedsSeek: false,
    operation: null,
    workerAnalysisLevel: 'worker',
  });
});

describe('shared analyzer selection', () => {
  it('projects aggregate selection and the complete run VizState selection', () => {
    useViz.getState().setAggregateSelection({
      kind: 'aggregate',
      workspaceId: 'w_main',
      experimentId: 's_1',
      panelId: 'tpot',
    });
    expect(analyzerSelectionFromVizState(useViz.getState())).toEqual({
      kind: 'aggregate',
      workspaceId: 'w_main',
      experimentId: 's_1',
      panelId: 'tpot',
    });

    useViz.setState({
      selectionSurface: 'run',
      runWorkspaceId: 'w_main',
      runId: 'r_1',
      runPanelId: 'kernel-time-breakdown',
      scope: 'kernel',
      poolRole: 'ffn',
      workerKey: makeWorkerKey('ffn', '0'),
      leafId: 52,
      cursorMs: 120_500,
      workerAnalysisLevel: 'iteration',
    });
    expect(analyzerSelectionFromVizState(useViz.getState())).toEqual({
      kind: 'run',
      workspaceId: 'w_main',
      runId: 'r_1',
      panelId: 'kernel-time-breakdown',
      scope: 'kernel',
      poolRole: 'ffn',
      workerKey: 'ffn/0',
      leafId: 52,
      parId: null,
      cursorMs: 120_500,
      cursorNeedsSeek: false,
      operation: null,
      workerAnalysisLevel: 'iteration',
    });
  });

  it('adds inquiry identity only when both ids exist', () => {
    useViz
      .getState()
      .setAggregateSelection({ kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_1' });
    useViz.getState().setInquiryContextIdentity('inq_01', null);
    expect(inquiryContextFromVizState(useViz.getState())).toBeNull();

    useViz.getState().setInquiryContextIdentity('inq_01', 'refine_01');
    expect(inquiryContextFromVizState(useViz.getState())).toMatchObject({
      protocol: 'vibesim.inquiry-context/v2',
      inquiryId: 'inq_01',
      phaseId: 'refine_01',
      selection: { kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_1' },
    });
  });

  it('publishes one versioned message per semantic selection change', () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    const received: unknown[] = [];
    const listener = (event: Event) => received.push((event as CustomEvent<unknown>).detail);
    window.addEventListener(ANALYZER_SELECTION_CHANGE_EVENT, listener);
    const uninstall = installAnalyzerSelectionPublisher();

    useViz
      .getState()
      .setAggregateSelection({ kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_1' });
    useViz
      .getState()
      .setAggregateSelection({ kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_1' });
    useViz.getState().setInquiryContextIdentity('inq_01', 'refine_01');

    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      protocol: 'vibesim.analyzer/v2',
      type: 'selection-change',
      revision: 1,
      selection: { kind: 'aggregate', workspaceId: 'w_main', experimentId: 's_1' },
    });
    expect(received[1]).toMatchObject({
      revision: 2,
      context: { inquiryId: 'inq_01', phaseId: 'refine_01' },
    });
    expect(postMessage).toHaveBeenCalledTimes(2);

    uninstall();
    window.removeEventListener(ANALYZER_SELECTION_CHANGE_EVENT, listener);
  });
});
