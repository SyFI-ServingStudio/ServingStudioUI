import { describe, expect, it } from 'vitest';

import {
  closeConversation,
  finishDraft,
  showConversation,
  startNewConversation,
} from './agentLocation';
import type { ConversationId, Location, WorkspaceId } from '../location';

const WORKSPACE = 'w_main' as WorkspaceId;
const CREATED = 'c_created' as ConversationId;

function result(chat: Extract<Location, { view: 'result' }>['chat'] = null): Location {
  return {
    view: 'result',
    ref: { kind: 'run', id: 'run-1', workspace: WORKSPACE },
    focus: { path: [], cursorMs: null, panel: null, options: {} },
    chat,
  };
}

describe('Agent Location transforms', () => {
  it('keeps a conversation docked when it changes beside a result', () => {
    expect(
      showConversation(result(), { state: 'created', workspace: WORKSPACE, id: CREATED }),
    ).toEqual(result({ state: 'created', workspace: WORKSPACE, id: CREATED }));
  });

  it('opens a clean draft in the same place as the current Agent', () => {
    expect(startNewConversation(result(), WORKSPACE)).toEqual(
      result({ state: 'draft', workspace: WORKSPACE }),
    );
    expect(
      startNewConversation(
        { view: 'chat', chat: { state: 'created', workspace: WORKSPACE, id: CREATED } },
        WORKSPACE,
      ),
    ).toEqual({ view: 'chat', chat: { state: 'draft', workspace: WORKSPACE } });
  });

  it('replaces only the draft that received the backend id', () => {
    expect(
      finishDraft(result({ state: 'draft', workspace: WORKSPACE }), WORKSPACE, CREATED),
    ).toEqual(result({ state: 'created', workspace: WORKSPACE, id: CREATED }));
    expect(finishDraft(result(null), WORKSPACE, CREATED)).toBeNull();
    expect(
      finishDraft(
        result({ state: 'created', workspace: WORKSPACE, id: 'c_other' as ConversationId }),
        WORKSPACE,
        CREATED,
      ),
    ).toBeNull();
  });

  it('does not dock a conversation from another workspace beside a result', () => {
    const other = 'w_other' as WorkspaceId;
    expect(showConversation(result(), { state: 'created', workspace: other, id: CREATED })).toEqual(
      {
        view: 'chat',
        chat: { state: 'created', workspace: other, id: CREATED },
      },
    );
  });

  it('closes a dock in place and a full Agent into its workspace catalog', () => {
    expect(closeConversation(result({ state: 'draft', workspace: WORKSPACE }))).toEqual(result());
    expect(
      closeConversation({
        view: 'chat',
        chat: { state: 'created', workspace: WORKSPACE, id: CREATED },
      }),
    ).toEqual({
      view: 'catalog',
      filter: { workspace: WORKSPACE, kinds: [], query: null },
    });
  });
});
