import { afterEach, describe, expect, it } from 'vitest';

import {
  agentSettingsFromConversation,
  DEFAULT_AGENT_SETTINGS,
  rolesForAgentMode,
  saveAgentSettings,
  savedAgentSettings,
} from './agentMode';

afterEach(() => {
  window.localStorage.clear();
});

describe('agent mode', () => {
  it('runs the delegating pair or the single assistant, driving role first', () => {
    expect(rolesForAgentMode('orchestrated')).toEqual(['orchestrator', 'implementer']);
    expect(rolesForAgentMode('single')).toEqual(['assistant']);
  });

  it('round-trips a non-default choice and clears the keys on the way back', () => {
    saveAgentSettings({ agentMode: 'single', autonomous: false });
    expect(savedAgentSettings()).toEqual({ agentMode: 'single', autonomous: false });

    saveAgentSettings(DEFAULT_AGENT_SETTINGS);
    expect(savedAgentSettings()).toEqual(DEFAULT_AGENT_SETTINGS);
    expect(window.localStorage.getItem('vibesim.agent.mode')).toBeNull();
    expect(window.localStorage.getItem('vibesim.agent.autonomous')).toBeNull();
  });

  it('ignores a stored mode the backend would not accept', () => {
    window.localStorage.setItem('vibesim.agent.mode', 'duo');

    expect(savedAgentSettings().agentMode).toBe('orchestrated');
  });

  it('lets the conversation record override the browser preference', () => {
    const preference = { agentMode: 'single', autonomous: false } as const;

    expect(agentSettingsFromConversation('orchestrated', true, preference)).toEqual({
      agentMode: 'orchestrated',
      autonomous: true,
    });
    // A backend too old to report either field leaves the preference standing.
    expect(agentSettingsFromConversation(undefined, undefined, preference)).toEqual(preference);
  });
});
