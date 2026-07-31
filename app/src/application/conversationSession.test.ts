import { beforeEach, describe, expect, it } from 'vitest';

import {
  activeConversationId,
  forgetActiveConversation,
  rememberActiveConversation,
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
});
