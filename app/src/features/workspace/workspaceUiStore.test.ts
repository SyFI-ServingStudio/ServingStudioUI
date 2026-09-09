import { beforeEach, describe, expect, it } from 'vitest';

import {
  agentPanelModeForWorkspaceView,
  clampAgentPanelWidth,
  DEFAULT_AGENT_PANEL_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  useWorkspaceUi,
} from './workspaceUiStore';

describe('workspace UI store', () => {
  beforeEach(() => {
    useWorkspaceUi.setState({
      agentPanelMode: 'spine',
      agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
    });
  });

  it('clamps drag and keyboard widths to the pane and viewport bounds', () => {
    expect(clampAgentPanelWidth(100, 1280)).toBe(MIN_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(900, 1600)).toBe(MAX_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(700, 1000)).toBe(480);
  });

  it('maps legacy routes onto one Agent layout state machine', () => {
    expect(agentPanelModeForWorkspaceView('agent', 'agent', 'spine', false)).toBe('full');
    expect(agentPanelModeForWorkspaceView('agent', 'aggregate', 'full', false)).toBe('docked');
    expect(agentPanelModeForWorkspaceView('aggregate', 'run', 'docked', false)).toBe('docked');
    expect(agentPanelModeForWorkspaceView('run', 'aggregate', 'hidden', false)).toBe('spine');
    expect(agentPanelModeForWorkspaceView('aggregate', 'aggregate', 'spine', true)).toBe('docked');
  });

  it('folds a full-width Agent to docked when one of its file links opens', () => {
    expect(agentPanelModeForWorkspaceView('agent', 'file', 'full', false)).toBe('docked');
    // A file opened from an already-docked Agent leaves the layout alone.
    expect(agentPanelModeForWorkspaceView('run', 'file', 'docked', false)).toBe('docked');
  });
});
