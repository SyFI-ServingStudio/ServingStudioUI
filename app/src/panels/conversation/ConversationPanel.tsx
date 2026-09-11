/**
 * One conversation, rendered.
 *
 * The panel owns layout and input and nothing else: what a turn is, when to
 * reload, and how a late response is discarded all live in `session/`. That
 * split is what lets the same panel serve the full-page view and the dock
 * beside a result without either copy re-deciding when a turn has ended.
 *
 * It never unmounts the controller. Undocking, navigating to another result, or
 * switching to the full page unmounts *this component*, and the session keeps
 * running underneath — which is the whole reason the controller is not a hook.
 */
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '../../session/useSession';
import type { SessionRef } from '../../session/types';
import type { TimelineStep, TurnOutcome } from '../../session/projection';
import { conversationRows, statusNote, type ConversationRow } from './view';

export interface ConversationPanelProps {
  session: SessionRef;
  /** Rendered in the header when the surrounding view offers a way out. */
  onClose?: () => void;
  title?: string;
}

export function ConversationPanel({ session, onClose, title }: ConversationPanelProps) {
  const { state, controller } = useSession(session);
  const rows = useMemo(() => conversationRows(state), [state]);
  const note = statusNote(state);
  const busy = state.status === 'streaming' || state.status === 'cancelling';
  const [toOrchestrator, setToOrchestrator] = useState(false);
  // The choice is about the role that is currently interrupted. When that
  // changes — a new turn was interrupted, or the last one resumed — the choice
  // no longer refers to anything, and keeping it would silently redirect a
  // message the user never meant to redirect.
  useEffect(() => setToOrchestrator(false), [state.interruptedRole]);

  return (
    <Stack spacing={1.5} sx={{ height: '100%', minHeight: 0 }} data-testid="conversation">
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="h6" component="h2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {title ?? 'Conversation'}
        </Typography>
        <Chip size="small" label={state.status} data-testid="session-status" />
        {onClose === undefined ? null : (
          // Closing only stops showing the conversation. The connection is
          // released by `useSession` when the last view goes — closing here
          // would silence a second panel showing the same conversation — and
          // the turn is not touched either way: it keeps running on the server.
          <Button size="small" data-testid="close-chat" onClick={onClose}>
            Close
          </Button>
        )}
      </Stack>

      {state.hasEarlier ? (
        <Button
          size="small"
          onClick={() => void controller.loadEarlier()}
          data-testid="load-earlier"
        >
          Load earlier messages
        </Button>
      ) : null}

      <Transcript rows={rows} />

      {note === null ? null : (
        <Alert
          severity={state.status === 'failed' ? 'error' : 'info'}
          data-testid="session-note"
          action={
            // Both states are recovered the same way — read the conversation
            // again and pick up whatever turn is running — and both need the
            // reader to ask, because neither is a state to retry silently in a
            // loop. Only the word differs, because the two situations do.
            state.status === 'detached' || state.status === 'failed' ? (
              <Button size="small" onClick={() => controller.attach()} data-testid="reattach">
                {state.status === 'failed' ? 'Retry' : 'Reattach'}
              </Button>
            ) : undefined
          }
        >
          {note}
        </Alert>
      )}

      {/* Shown whatever the session is doing. A page of history that would not
          load, or a cancel the backend refused, does not stop the conversation
          — and reporting those only when everything has failed is the same as
          not reporting them. */}
      {state.error === null ? null : (
        <Alert severity="warning" data-testid="session-error">
          {state.error}
        </Alert>
      )}

      {state.interruptedRole === '' ? null : (
        // A turn was interrupted and its follow-up has not been sent. Where the
        // next message lands is not guessable from the transcript, and it is
        // the one thing the user needs to know before typing — along with the
        // ability to say "not there, start again from the top", which is the
        // only way out when the interrupted role was the wrong one.
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 0 }}
            data-testid="resume-role"
          >
            {toOrchestrator
              ? 'Your next message goes to the orchestrator.'
              : `Your next message continues ${state.interruptedRole}.`}
          </Typography>
          <Button
            size="small"
            onClick={() => setToOrchestrator((chosen) => !chosen)}
            data-testid="resume-target"
          >
            {toOrchestrator ? `Continue ${state.interruptedRole}` : 'Back to orchestrator'}
          </Button>
        </Stack>
      )}

      <Divider />
      <Composer
        disabled={!controller.canSend()}
        busy={busy}
        // `resume_role: ''` is how the backend is told to start from the
        // orchestrator; omitting the field entirely means "wherever the last
        // turn was interrupted", which is the default and needs nothing said.
        onSend={(text) => void controller.send(text, toOrchestrator ? { resume_role: '' } : {})}
        onInterrupt={() => void controller.interrupt()}
        cancelling={state.status === 'cancelling'}
      />
    </Stack>
  );
}

/**
 * The messages, oldest first, scrolled to the newest.
 *
 * Following the tail is conditional on already being near it: a reader who has
 * scrolled up to re-read something is reading, and yanking them back down every
 * time a token arrives makes a running turn impossible to read alongside.
 */
function Transcript({ rows }: { rows: readonly ConversationRow[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  const atEnd = useRef(true);

  useEffect(() => {
    const node = box.current;
    if (node === null || !atEnd.current) return;
    node.scrollTop = node.scrollHeight;
  }, [rows]);

  return (
    <Box
      ref={box}
      onScroll={(event) => {
        const node = event.currentTarget;
        atEnd.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      }}
      sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 1 }}
    >
      <Stack spacing={1.5}>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No messages yet.
          </Typography>
        ) : (
          rows.map((row) => <MessageRow key={row.key} row={row} />)
        )}
      </Stack>
    </Box>
  );
}

function MessageRow({ row }: { row: ConversationRow }) {
  const mine = row.role === 'user';
  return (
    <Stack
      spacing={0.5}
      data-testid="message"
      data-role={row.role}
      data-live={row.live ? 'true' : 'false'}
      sx={{
        alignSelf: mine ? 'flex-end' : 'stretch',
        maxWidth: mine ? '80%' : '100%',
        bgcolor: mine ? 'action.hover' : 'transparent',
        borderRadius: 1,
        px: mine ? 1.5 : 0,
        py: mine ? 1 : 0,
      }}
    >
      {mine ? null : (
        <Typography variant="caption" color="text.secondary">
          {row.role}
        </Typography>
      )}
      {row.steps.length === 0 ? null : <Steps steps={row.steps} />}
      {row.text === '' ? null : (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {row.text}
        </Typography>
      )}
      <Ending outcome={row.outcome} />
    </Stack>
  );
}

/**
 * How the turn ended, when it ended as something other than an answer.
 *
 * A turn that stopped to ask the reader something looks exactly like a turn
 * that answered — same text, same place — and the difference is whether the
 * conversation is waiting on the agent or on the reader. Saying so is the
 * difference between a pause and a hang. A stopped turn has the same problem
 * for a different reason: its text is real, it is just not the whole reply.
 */
function Ending({ outcome }: { outcome: TurnOutcome }) {
  if (outcome === 'input-needed') {
    return (
      <Chip
        size="small"
        color="info"
        variant="outlined"
        label="Waiting for your reply"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="outcome-input-needed"
      />
    );
  }
  if (outcome === 'failure') {
    return (
      <Chip
        size="small"
        color="error"
        variant="outlined"
        label="This turn failed"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="outcome-failure"
      />
    );
  }
  if (outcome === 'stopped') {
    // Default, not error: the reader pressed Stop, so nothing went wrong. What
    // the label is for is that the text above it breaks off mid-thought, and
    // unlabelled that reads as an answer that trailed away.
    return (
      <Chip
        size="small"
        variant="outlined"
        label="You stopped this turn"
        sx={{ alignSelf: 'flex-start' }}
        data-testid="outcome-stopped"
      />
    );
  }
  return null;
}

/**
 * What the turn did before it answered.
 *
 * Shown above the answer rather than behind a toggle, because while the turn is
 * running they are the only thing there is to read: a collapsed timeline would
 * make a working agent indistinguishable from a stuck one. They are what the
 * turn did, which is not the same as evidence for what it concluded — that is
 * the citations' job, and it is not built yet.
 */
function Steps({ steps }: { steps: readonly TimelineStep[] }) {
  return (
    <Stack component="ul" spacing={0.25} sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {steps.map((step, index) => (
        <Stack
          component="li"
          key={`${step.kind}-${index}`}
          direction="row"
          spacing={1}
          alignItems="baseline"
          data-step={step.kind}
        >
          <Typography
            variant="caption"
            color={step.milestone ? 'text.primary' : 'text.secondary'}
            sx={{ minWidth: 96, flex: '0 0 auto' }}
          >
            {step.role ?? step.kind}
          </Typography>
          <Typography
            variant={step.substantive ? 'body2' : 'caption'}
            color={step.substantive ? 'text.primary' : 'text.secondary'}
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {step.text}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

interface ComposerProps {
  disabled: boolean;
  busy: boolean;
  cancelling: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

/**
 * The input, and the stop button that is not a close button.
 *
 * Interrupting is offered only while a turn is running, and it asks the server
 * to stop rather than dropping the subscription — the difference matters
 * because a turn that keeps running unheard is the failure mode a stop button
 * is supposed to prevent.
 */
export function Composer({ disabled, busy, cancelling, onSend, onInterrupt }: ComposerProps) {
  const [text, setText] = useState('');
  const trimmed = text.trim();

  const submit = () => {
    if (disabled || trimmed === '') return;
    onSend(trimmed);
    setText('');
  };

  return (
    <Stack direction="row" spacing={1} alignItems="flex-end">
      <TextField
        fullWidth
        multiline
        maxRows={8}
        size="small"
        placeholder="Ask about this result…"
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        inputProps={{ 'data-testid': 'composer' }}
      />
      {busy ? (
        <Button
          variant="outlined"
          color="warning"
          size="small"
          startIcon={cancelling ? <CircularProgress size={14} /> : <StopIcon />}
          disabled={cancelling}
          onClick={onInterrupt}
          data-testid="interrupt"
        >
          {cancelling ? 'Stopping' : 'Stop'}
        </Button>
      ) : (
        <IconButton
          color="primary"
          disabled={disabled || trimmed === ''}
          onClick={submit}
          aria-label="Send"
          data-testid="send"
        >
          <SendIcon />
        </IconButton>
      )}
    </Stack>
  );
}
