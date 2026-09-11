export type AgentPanelMode = 'spine' | 'docked' | 'full';

export const MIN_AGENT_PANEL_WIDTH = 320;
export const MAX_AGENT_PANEL_WIDTH = 720;
export const DEFAULT_AGENT_PANEL_WIDTH = 410;

/** Panel width is local layout state; the result Location never carries it. */
export function clampAgentPanelWidth(width: number, viewportWidth: number): number {
  const availableWidth = Math.max(MIN_AGENT_PANEL_WIDTH, viewportWidth - 520);
  return Math.min(
    Math.max(Math.round(width), MIN_AGENT_PANEL_WIDTH),
    Math.min(MAX_AGENT_PANEL_WIDTH, availableWidth),
  );
}

export function initialAgentPanelMode(agentOpen: boolean, fullAgent: boolean): AgentPanelMode {
  if (fullAgent) return 'full';
  return agentOpen ? 'docked' : 'spine';
}

/**
 * Reconcile route-owned presence with a reader's local fold choice.
 *
 * Opening a new chat exposes it. Moving between results while the same chat is
 * folded keeps it folded. A full-page chat owns the whole viewport, and leaving
 * it returns an existing chat to the dock.
 */
export function nextAgentPanelMode(
  current: AgentPanelMode,
  wasOpen: boolean,
  agentOpen: boolean,
  fullAgent: boolean,
): AgentPanelMode {
  if (fullAgent) return 'full';
  if (!agentOpen) return 'spine';
  if (current === 'full' || !wasOpen) return 'docked';
  return current;
}
