import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeConversationId,
  forgetActiveConversation,
  forgetPendingCodexBackends,
  pendingCodexBackends,
  rememberActiveConversation,
  rememberPendingCodexBackends,
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

  it('carries a valid role backend selection between entry and agent surfaces', () => {
    const selection = { orchestrator: 'codexds', implementer: 'traditional' } as const;

    rememberPendingCodexBackends(selection);
    expect(pendingCodexBackends()).toEqual(selection);
    forgetPendingCodexBackends();
    expect(pendingCodexBackends()).toBeNull();
  });
});
