import { describe, expect, it } from 'vitest';

import {
  idleState,
  type SessionState,
  type StoredMessage,
  type TurnEvent,
} from '../../session/types';
import { conversationRows, statusNote } from './view';

const REF = { workspace: 'w_main', conversation: 'c1' };

function state(patch: Partial<SessionState> = {}): SessionState {
  return { ...idleState(REF), ...patch };
}

const stored: StoredMessage[] = [
  { id: 7, role: 'user', content: 'why is attn slow?' },
  {
    id: 8,
    role: 'assistant',
    content: 'Because of the decode kernels.',
    // The backend's real shape: the answer is both the last activity step and
    // the message content.
    activity: [
      { kind: 'decision', action: 'inspect', task: 'kernel time' },
      { kind: 'final', text: 'Because of the decode kernels.' },
    ],
  },
];

describe('conversationRows', () => {
  it('keys a stored message by the backend’s row id', () => {
    // Position would reorder every key when an earlier page loads above.
    expect(conversationRows(state({ messages: stored })).map((row) => row.key)).toEqual([
      '#7',
      '#8',
    ]);
  });

  it('keys a message written before ids were published by its absolute position', () => {
    const rows = conversationRows(
      state({ messages: [{ role: 'user', content: 'old' }], startIndex: 12 }),
    );
    expect(rows[0].key).toBe('@12');
  });

  it('shows an assistant message’s steps without repeating its answer', () => {
    const [, answer] = conversationRows(state({ messages: stored }));
    expect(answer.steps.map((step) => step.text)).toEqual(['inspect: kernel time']);
    expect(answer.text).toBe('Because of the decode kernels.');
  });

  it('appends the turn in flight as its own row', () => {
    const live: TurnEvent[] = [
      { kind: 'role_start', role: 'planner' },
      { kind: 'decision', action: 'read', task: 'the run' },
    ];
    const rows = conversationRows(state({ messages: stored, live }));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ key: 'live', role: 'planner', text: '', live: true });
    expect(rows[2].steps.map((step) => step.text)).toEqual(['read: the run']);
  });

  it('shows the live answer as it lands', () => {
    const rows = conversationRows(state({ live: [{ kind: 'final', text: 'partly answered' }] }));
    expect(rows[0].text).toBe('partly answered');
  });

  it('has no live row once the turn has been stored', () => {
    expect(conversationRows(state({ messages: stored, live: [] }))).toHaveLength(2);
  });

  it('carries how the turn ended, so a row waiting on the reader can say so', () => {
    const rows = conversationRows(
      state({
        live: [{ kind: 'done', text: 'Which model did you mean?', outcome: 'request_user_input' }],
      }),
    );
    expect(rows[0].outcome).toBe('input-needed');
    // And the answer is not also printed as a step.
    expect(rows[0].steps).toEqual([]);
  });

  it('carries a stop, so the half-written row is not read as the reply', () => {
    const rows = conversationRows(
      state({
        live: [
          { kind: 'done', text: 'Stopped while the planner was working.', outcome: 'cancelled' },
        ],
      }),
    );
    expect(rows[0].outcome).toBe('stopped');
  });
});

describe('statusNote', () => {
  it('says nothing when there is nothing to say', () => {
    expect(statusNote(state())).toBeNull();
  });

  it('distinguishes a turn this browser is not hearing from one that ended', () => {
    expect(statusNote(state({ status: 'detached' }))).toContain('continues on the server');
    expect(statusNote(state({ status: 'streaming' }))).toBe('Working…');
  });

  it('says the conversation failed without swallowing the reason', () => {
    // The reason is `state.error`, rendered on its own so that failures which
    // do not stop the session — a page of history, a refused cancel — are seen
    // as well.
    expect(statusNote(state({ status: 'failed', error: '404 for /c1' }))).toBe(
      'This conversation could not be loaded.',
    );
  });
});
