/**
 * The chat surface: a draft becoming a conversation, and a conversation once it is.
 *
 * A draft is a real, shareable address — "open the composer in this workspace" —
 * and not a placeholder the application invents. What it becomes when the first
 * message is sent depends on where it is being shown: the full page goes to
 * `#/chat/<id>`, and a dock beside a result keeps the result and fills in its
 * `chat=`. So this component does not navigate; it reports the id and the
 * surrounding view decides the address. That is also why the same component
 * serves both places instead of being copied.
 *
 * The transition is a `replace`, wherever it lands: the draft and the
 * conversation it turned into are one step in the user's history, and a back
 * button that returned to an empty composer already used would be offering to
 * redo something that is done.
 */
import { Alert, Box, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

import type { ChatRef, ConversationId, Navigate, WorkspaceId } from '../../location';
import { describeError } from '../../session/api';
import type { Unsubscribe } from '../../session/controller';
import { startConversation, type StartConversationOptions } from '../../session/draft';
import { sessionKey, type SessionRef } from '../../session/types';
import { Composer, ConversationPanel } from './ConversationPanel';

export interface ChatProps {
  chat: ChatRef;
  /** Called once, with the id the backend issued for a draft. */
  onCreated: (id: ConversationId) => void;
  onClose?: () => void;
  title?: string;
  /** Runtime and Agent choices used only while a draft becomes a conversation. */
  startOptions?: StartConversationOptions;
}

/** A connection a draft opened, kept until the conversation it belongs to goes. */
interface Lease {
  /**
   * Whose connection this is, spelled the way the registry spells it.
   *
   * The conversation id alone is not that identity: a controller belongs to a
   * `(workspace, conversation)` pair, so an address that kept the id and
   * changed the workspace would look unchanged here and go on holding a
   * connection to a session nothing is showing.
   */
  readonly session: string;
  readonly release: Unsubscribe;
}

export function Chat({ chat, onCreated, onClose, title, startOptions }: ChatProps) {
  // Sending attaches, so that the panel arriving on the new address finds a
  // session already running rather than loading history over the turn. Somebody
  // has to hold that connection in between, and it is this component rather
  // than the draft: the draft unmounts during the handover, and a holder that
  // unmounts has to reason about exactly when its replacement mounts. This one
  // does not move — the same `Chat` shows the draft and then the conversation —
  // so the connection is simply held across the change and let go of when the
  // reader leaves the conversation or the surface closes.
  const lease = useRef<Lease | null>(null);
  const showing =
    chat.state === 'created'
      ? sessionKey({ workspace: chat.workspace, conversation: chat.id })
      : null;
  const drop = () => {
    const held = lease.current;
    lease.current = null;
    held?.release();
  };
  useEffect(() => {
    // Whatever is on screen is not what this connection was opened for: either
    // the reader moved on, or nothing ever claimed it. Holding it any longer
    // would keep a conversation the reader has left listening for events.
    if (lease.current !== null && lease.current.session !== showing) drop();
  }, [showing]);
  useEffect(() => () => drop(), []);

  if (chat.state === 'created') {
    // No validation here. A `ChatRef` in the `created` state has already been
    // through `conversationIdSchema` and `workspaceIdSchema` at the address
    // gate, and `SessionRef` is those same two schemas — so parsing it again
    // could only ever succeed, and the failure branch it needed was a piece of
    // error handling no reader could evaluate and no test could reach.
    const session: SessionRef = { workspace: chat.workspace, conversation: chat.id };
    return (
      <Box sx={{ height: '100%', minHeight: 0 }}>
        {/* Keyed by the conversation so that what the reader has typed but not
            sent, and the "start again from the top" toggle, belong to the
            conversation they were meant for. Without it the dock keeps one
            component across a change of conversation, and a half-written
            question follows the reader into someone else's transcript. */}
        <ConversationPanel
          key={sessionKey(session)}
          session={session}
          onClose={onClose}
          title={title}
        />
      </Box>
    );
  }
  return (
    // Keyed for the same reason, and for one more: a draft that has sent its
    // message is waiting for an id, and moving to another workspace is a
    // different draft with nothing outstanding. Carrying the old one's state
    // over left the new composer disabled with nothing on its way.
    <DraftChat
      key={chat.workspace}
      workspace={chat.workspace}
      onCreated={onCreated}
      onHold={(held) => {
        lease.current = held;
      }}
      onClose={onClose}
      startOptions={startOptions}
    />
  );
}

/** The full-page chat view. */
export function ChatPage({ chat, navigate }: { chat: ChatRef; navigate: Navigate }) {
  return (
    <Chat
      chat={chat}
      onCreated={(id) =>
        navigate(
          { view: 'chat', chat: { state: 'created', workspace: chat.workspace, id } },
          'replace',
        )
      }
    />
  );
}

/**
 * The composer for a conversation that does not exist yet.
 *
 * Creating one is a round trip, and the reader can be somewhere else by the time
 * it answers: the dock stays mounted while they move between results, so where
 * a new id should be reported can have changed underneath the request. The
 * callback is therefore read at completion time rather than captured when Send
 * was pressed, and a draft that is no longer showing reports nothing —
 * announcing a conversation into an address the reader has left is worse than
 * not announcing it. The turn itself is unaffected either way: it belongs to a
 * controller that outlives this component.
 */
function DraftChat({
  workspace,
  onCreated,
  onHold,
  onClose,
  startOptions,
}: {
  workspace: WorkspaceId;
  onCreated: (id: ConversationId) => void;
  /** Hands the turn's connection to the surface, which outlives this draft. */
  onHold: (lease: Lease) => void;
  onClose?: () => void;
  startOptions?: StartConversationOptions;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useRef({ onCreated, showing: true });
  useEffect(() => {
    // Refreshed after every render, so a completion always reports through the
    // current callback rather than the one captured when Send was pressed.
    // `showing` is set here as well as cleared in the cleanup: React's
    // development double-mount runs the cleanup between two mounts, and a flag
    // that were only cleared would leave the second mount unable to report.
    now.current = { onCreated, showing: true };
    return () => {
      now.current.showing = false;
    };
  });

  const start = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const { session, release } = await startConversation(workspace, text, startOptions);
      // The conversation is created and its turn is running whatever happens
      // next; the only question is whether this address still wants to hear
      // about it.
      if (!now.current.showing) {
        // Gone before the backend answered, so the cleanup below has already
        // run and there is nothing to hand this to. The turn continues on the
        // server; what is let go of is only this browser's connection to it.
        release();
        return;
      }
      // Handed over before the id is reported, so that the surface is already
      // holding the connection by the time it navigates.
      onHold({ session: sessionKey(session), release });
      now.current.onCreated(session.conversation);
    } catch (failure) {
      setError(describeError(failure));
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }} data-testid="draft-chat">
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2">
            New conversation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            In workspace {workspace}. It is created when you send the first message.
          </Typography>
        </Box>
        {onClose === undefined ? null : (
          <Typography
            component="button"
            variant="body2"
            onClick={onClose}
            sx={{ background: 'none', border: 0, cursor: 'pointer', color: 'primary.main' }}
          >
            Close
          </Typography>
        )}
      </Stack>
      {error === null ? null : <Alert severity="error">{error}</Alert>}
      <Composer
        disabled={busy}
        busy={false}
        cancelling={false}
        onSend={(text) => void start(text)}
        onInterrupt={() => undefined}
      />
    </Stack>
  );
}
