import type { AgentMode, AgentSettings } from './agentTypes';

/**
 * The conversation-level agent contract: how many Codex roles run a turn, and
 * whether the agent may decide on its own instead of stopping to ask.
 *
 * Both values are pinned by the first message — the Codex sessions a turn
 * builds are per role, so a mid-conversation switch would strand them. The
 * picker therefore reads as a setup choice, not a live toggle.
 */

const AGENT_MODE_KEY = 'vibesim.agent.mode';
const AUTONOMOUS_KEY = 'vibesim.agent.autonomous';

/**
 * Defaults deliberately reproduce what this UI did before the picker existed
 * (`autonomous` was hard-coded true, and only the orchestrated cast existed),
 * so adding the control changes nobody's behavior until they touch it.
 */
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agentMode: 'orchestrated',
  autonomous: true,
};

export type CodexRoleName = 'orchestrator' | 'implementer' | 'assistant';

const ORCHESTRATED_ROLES: readonly CodexRoleName[] = ['orchestrator', 'implementer'];
const SINGLE_ROLES: readonly CodexRoleName[] = ['assistant'];

/** Mirrors the backend's `roles_for_agent_mode`; driving role first. */
export function rolesForAgentMode(agentMode: AgentMode): readonly CodexRoleName[] {
  return agentMode === 'single' ? SINGLE_ROLES : ORCHESTRATED_ROLES;
}

/**
 * The captions, in one place.
 *
 * They name the thing rather than describe its manner: `Human-in-the-loop` and
 * `Autonomous` are terms a reader of this product already holds, where an
 * earlier draft's `Stops to ask you` / `Decides and reports` explained them to
 * someone who did not. Every surface — the plates, the folded step line, the
 * locked restatement — renders from here, so a wording change lands once.
 */
export const CAST_CAPTIONS: Record<AgentMode, string> = {
  orchestrated: '2 Agents',
  single: 'Single Agent',
};

export const AUTONOMY_CAPTIONS = {
  supervised: 'Human-in-the-loop',
  autonomous: 'Autonomous',
} as const;

/** The one sentence both the picker and its locked form restate. */
export function agentSettingsSentence(settings: AgentSettings): {
  cast: string;
  autonomy: string;
} {
  return {
    cast: CAST_CAPTIONS[settings.agentMode],
    autonomy: settings.autonomous ? AUTONOMY_CAPTIONS.autonomous : AUTONOMY_CAPTIONS.supervised,
  };
}

function agentModeFrom(value: unknown): AgentMode | null {
  return value === 'single' || value === 'orchestrated' ? value : null;
}

/** A durable preference, so a user who prefers one cast keeps it across visits. */
export function savedAgentSettings(): AgentSettings {
  try {
    return {
      agentMode: agentModeFrom(window.localStorage.getItem(AGENT_MODE_KEY)) ?? 'orchestrated',
      // Absent means the default, so only the non-default state is written.
      autonomous: window.localStorage.getItem(AUTONOMOUS_KEY) !== 'false',
    };
  } catch {
    // Storage can be unavailable in privacy-restricted embeds; the picker still
    // works for this mount, it just starts from the defaults every time.
    return DEFAULT_AGENT_SETTINGS;
  }
}

export function saveAgentSettings(settings: AgentSettings): void {
  try {
    if (settings.agentMode === DEFAULT_AGENT_SETTINGS.agentMode) {
      window.localStorage.removeItem(AGENT_MODE_KEY);
    } else {
      window.localStorage.setItem(AGENT_MODE_KEY, settings.agentMode);
    }
    if (settings.autonomous === DEFAULT_AGENT_SETTINGS.autonomous) {
      window.localStorage.removeItem(AUTONOMOUS_KEY);
    } else {
      window.localStorage.setItem(AUTONOMOUS_KEY, 'false');
    }
  } catch {
    // Nothing to persist in a restricted embed; the current UI state still works.
  }
}

/** What the server said this conversation is, falling back to the local choice. */
export function agentSettingsFromConversation(
  agentMode: AgentMode | undefined,
  autonomous: boolean | undefined,
  fallback: AgentSettings,
): AgentSettings {
  return {
    agentMode: agentModeFrom(agentMode) ?? fallback.agentMode,
    autonomous: typeof autonomous === 'boolean' ? autonomous : fallback.autonomous,
  };
}
