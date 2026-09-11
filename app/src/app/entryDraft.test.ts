import { afterEach, describe, expect, it, vi } from 'vitest';

import { storeEntryDraft } from './entryDraft';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entry draft handoff', () => {
  it('reports storage failure so the caller cannot navigate and lose the prompt', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'QuotaExceededError');
    });
    expect(() =>
      storeEntryDraft({
        workspace: 'w_main',
        prompt: 'keep this question',
        runtime: {
          orchestrator: { model: '', effort: '', serviceTier: 'default' },
          implementer: { model: '', effort: '', serviceTier: 'default' },
          assistant: { model: '', effort: '', serviceTier: 'default' },
        },
      }),
    ).toThrow('blocked');
  });
});
