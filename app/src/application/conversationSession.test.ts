import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeConversationId,
  forgetActiveConversation,
  forgetPendingCodexRuntime,
  pendingCodexRuntime,
  rememberActiveConversation,
  rememberPendingCodexRuntime,
} from './conversationSession';

describe('active conversation session', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('keeps the active conversation scoped to its workspace', () => {
    rememberActiveConversation('w_one', 'c_one');
    rememberActiveConversation('w_two', 'c_two');

    expect(activeConversationId('w_one')).toBe('c_one');
    expect(activeConversationId('w_two')).toBe('c_two');

    forgetActiveConversation('w_one');
    expect(activeConversationId('w_one')).toBeNull();
    expect(activeConversationId('w_two')).toBe('c_two');
  });

  it('carries a valid role runtime selection between entry and agent surfaces', () => {
    const selection = {
      orchestrator: { model: 'gpt-5.6-terra', effort: 'high', serviceTier: 'fast' },
      implementer: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
      assistant: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'fast' },
    } as const;

    rememberPendingCodexRuntime(selection);
    expect(pendingCodexRuntime()).toEqual(selection);
    forgetPendingCodexRuntime();
    expect(pendingCodexRuntime()).toBeNull();
  });

  it('rejects a stored selection that is not a model plus an effort', () => {
    window.sessionStorage.setItem(
      'vibesim.entry.codex-runtime',
      JSON.stringify({ orchestrator: 'codexds', implementer: 'traditional' }),
    );

    expect(pendingCodexRuntime()).toBeNull();
  });

  it('rejects a selection left by a tab that predates the single-agent role', () => {
    // Falling back to the backend catalog defaults is self-healing; carrying a
    // half-populated selection forward would start the assistant with no model.
    window.sessionStorage.setItem(
      'vibesim.entry.codex-runtime',
      JSON.stringify({
        orchestrator: { model: 'gpt-5.6-terra', effort: 'high', serviceTier: 'fast' },
        implementer: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
      }),
    );

    expect(pendingCodexRuntime()).toBeNull();
  });
});
