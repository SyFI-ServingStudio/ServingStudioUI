import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AGENT_PANEL_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  clampAgentPanelWidth,
  useWorkspaceUi,
} from './workspaceUiStore';

describe('workspace UI store', () => {
  beforeEach(() => {
    useWorkspaceUi.setState({
      agentPanelMode: 'spine',
      agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
    });
  });

  it('keeps panel geometry outside VizState and exposes every documented mode', () => {
    const state = useWorkspaceUi.getState();
    expect(useWorkspaceUi.getState().agentPanelMode).toBe('spine');
    state.setAgentPanelMode('docked');
    expect(useWorkspaceUi.getState().agentPanelMode).toBe('docked');
    state.setAgentPanelMode('full');
    expect(useWorkspaceUi.getState().agentPanelMode).toBe('full');
  });

  it('clamps drag and keyboard widths to the pane and viewport bounds', () => {
    expect(clampAgentPanelWidth(100, 1280)).toBe(MIN_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(900, 1600)).toBe(MAX_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(700, 1000)).toBe(480);
  });
});
