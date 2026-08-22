import { afterEach, describe, expect, it } from 'vitest';

import {
  agentSettingsFromConversation,
  agentSettingsSentence,
  DEFAULT_AGENT_SETTINGS,
  rolesForAgentMode,
  saveAgentSettings,
  savedAgentSettings,
} from './agentMode';

afterEach(() => {
  window.localStorage.clear();
});

describe('agent mode', () => {
  it('keeps the behaviour this UI had before the picker existed', () => {
    // The control only makes an existing hidden choice visible. If this ever
    // flips, every conversation started from a fresh browser changes cast or
    // starts stopping to ask, without anyone having asked for that.
    expect(DEFAULT_AGENT_SETTINGS).toEqual({ agentMode: 'orchestrated', autonomous: true });
    expect(savedAgentSettings()).toEqual(DEFAULT_AGENT_SETTINGS);
  });

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

  it('restates the choice as one sentence for both the grid and its locked form', () => {
    expect(agentSettingsSentence({ agentMode: 'single', autonomous: true })).toEqual({
      cast: 'One agent',
      autonomy: 'deciding without asking you',
    });
    expect(agentSettingsSentence({ agentMode: 'orchestrated', autonomous: false })).toEqual({
      cast: 'Two agents',
      autonomy: 'asking you when unsure',
    });
  });
});
