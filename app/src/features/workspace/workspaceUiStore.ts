import { create } from 'zustand';

export type AgentPanelMode = 'hidden' | 'spine' | 'docked' | 'full';

export const MIN_AGENT_PANEL_WIDTH = 320;
export const MAX_AGENT_PANEL_WIDTH = 720;
export const DEFAULT_AGENT_PANEL_WIDTH = 410;

export function clampAgentPanelWidth(width: number, viewportWidth = window.innerWidth): number {
  const availableWidth = Math.max(MIN_AGENT_PANEL_WIDTH, viewportWidth - 520);
  return Math.min(
    Math.max(Math.round(width), MIN_AGENT_PANEL_WIDTH),
    Math.min(MAX_AGENT_PANEL_WIDTH, availableWidth),
  );
}

interface WorkspaceUiState {
  agentPanelMode: AgentPanelMode;
  agentPanelWidth: number;
  setAgentPanelMode: (mode: AgentPanelMode) => void;
  setAgentPanelWidth: (width: number, viewportWidth?: number) => void;
}

/**
 * Pane geometry is deliberately isolated from VizState because it is never
 * part of the Analyzer context sent to an agent.
 */
export const useWorkspaceUi = create<WorkspaceUiState>((set) => ({
  agentPanelMode: 'spine',
  agentPanelWidth: DEFAULT_AGENT_PANEL_WIDTH,
  setAgentPanelMode: (agentPanelMode) => set({ agentPanelMode }),
  setAgentPanelWidth: (width, viewportWidth) =>
    set({ agentPanelWidth: clampAgentPanelWidth(width, viewportWidth) }),
}));
