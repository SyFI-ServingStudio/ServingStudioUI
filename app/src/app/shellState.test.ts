import { describe, expect, it } from 'vitest';

import {
  MAX_AGENT_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  clampAgentPanelWidth,
  initialAgentPanelMode,
  nextAgentPanelMode,
} from './shellState';

describe('workspace Shell state', () => {
  it('opens addressed chats and gives a full-page chat the viewport', () => {
    expect(initialAgentPanelMode(false, false)).toBe('spine');
    expect(initialAgentPanelMode(true, false)).toBe('docked');
    expect(initialAgentPanelMode(true, true)).toBe('full');
  });

  it('keeps a folded chat folded across result navigation', () => {
    expect(nextAgentPanelMode('spine', true, true, false)).toBe('spine');
  });

  it('exposes a newly addressed chat and docks one when leaving its full page', () => {
    expect(nextAgentPanelMode('spine', false, true, false)).toBe('docked');
    expect(nextAgentPanelMode('full', true, true, false)).toBe('docked');
  });

  it('returns to the spine when the address closes the chat', () => {
    expect(nextAgentPanelMode('docked', true, false, false)).toBe('spine');
  });

  it('clamps local width against both design bounds and the content column', () => {
    expect(clampAgentPanelWidth(100, 1280)).toBe(MIN_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(900, 1600)).toBe(MAX_AGENT_PANEL_WIDTH);
    expect(clampAgentPanelWidth(700, 1000)).toBe(480);
  });
});
