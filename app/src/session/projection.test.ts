import { describe, expect, it } from 'vitest';

import {
  activeRole,
  mergeEarlier,
  projectMessage,
  projectTurn,
  toStep,
  toTimeline,
} from './projection';
import type { StoredMessage, TurnEvent } from './types';

/** The steps of a projection, as text, which is what the assertions are about. */
function stepText(projected: { steps: readonly { text: string }[] }): string[] {
  return projected.steps.map((step) => step.text);
}

function event(kind: string, rest: Partial<TurnEvent> = {}): TurnEvent {
  return { kind, ...rest };
}

describe('toStep', () => {
  it('drops machinery events', () => {
    for (const kind of ['role_start', 'role_ready', 'session', 'usage']) {
      expect(toStep(event(kind, { text: 'anything' }))).toBeNull();
    }
  });

  it('keeps a tool call: what a turn ran is part of what it did', () => {
    expect(toStep(event('tool_call', { text: 'grep foo' }))).toMatchObject({
      kind: 'tool_call',
      substantive: false,
    });
  });

  it('drops an event with no text, substantive or not', () => {
    // An empty line says the model produced nothing, which is a different
    // claim from "the model was working".
    expect(toStep(event('final', { text: '' }))).toBeNull();
    expect(toStep(event('final'))).toBeNull();
  });

  it('reads a decision as its action and task', () => {
    expect(
      toStep(event('decision', { action: 'delegate', task: 'measure the kernel' })),
    ).toMatchObject({ text: 'delegate: measure the kernel' });
    expect(toStep(event('decision', { task: 'only a task' }))).toMatchObject({
      text: 'only a task',
    });
    expect(toStep(event('decision', { action: 'only an action' }))).toMatchObject({
      text: 'only an action',
    });
  });

  it('marks a milestone', () => {
    expect(toStep(event('intermediate_output', { text: 'x', level: 'milestone' }))).toMatchObject({
      milestone: true,
    });
  });

  it('renders an unknown kind rather than hiding it', () => {
    // The backend's vocabulary grows. A step this build does not recognize
    // should appear unlabelled, not vanish from the record.
    expect(toStep(event('some_future_kind', { text: 'happened' }))).toMatchObject({
      kind: 'some_future_kind',
      substantive: false,
      text: 'happened',
    });
  });

  it('reads an empty or null role as no role', () => {
    // The backend writes null for "not applicable" on several events.
    expect(toStep(event('final', { text: 'x', role: '' }))?.role).toBeNull();
    expect(toStep(event('final', { text: 'x', role: null }))?.role).toBeNull();
  });
});

describe('toTimeline', () => {
  it('keeps order and drops what has nothing to show', () => {
    expect(
      toTimeline([
        event('role_start', { role: 'planner' }),
        event('decision', { action: 'plan', task: 'a' }),
        event('final', { text: 'b' }),
      ]).map((step) => step.text),
    ).toEqual(['plan: a', 'b']);
  });
});

describe('projectMessage', () => {
  // What the backend actually stores: the answer is appended to the activity
  // list *and* saved as the message content.
  const activity = [
    event('decision', { action: 'plan', task: 'a' }),
    event('final', { text: 'b' }),
  ];

  it('excludes the answer, whose text is the message itself', () => {
    // Including it would print the answer twice — once as the last step and
    // once as the message — which reads as the model repeating itself.
    const row = projectMessage({ role: 'assistant', content: 'b', activity });
    expect(stepText(row)).toEqual(['plan: a']);
    expect(row.text).toBe('b');
    expect(row.outcome).toBe('answer');
  });

  it('excludes a failed turn\u2019s answer too, which is stored as an error step', () => {
    const row = projectMessage({
      role: 'assistant',
      content: 'The Agent stalled.',
      activity: [event('error', { text: 'The Agent stalled.' })],
    });
    expect(row.steps).toEqual([]);
    expect(row.text).toBe('The Agent stalled.');
    expect(row.outcome).toBe('failure');
  });

  it('says a turn is waiting on the reader rather than calling it an answer', () => {
    // `request_user_input` looks exactly like an answer \u2014 same text, same
    // place \u2014 and the difference is who the conversation is waiting for.
    const row = projectMessage({
      role: 'assistant',
      content: 'Which model did you mean?',
      activity: [
        event('done', { text: 'Which model did you mean?', outcome: 'request_user_input' }),
      ],
    });
    expect(row.outcome).toBe('input-needed');
  });

  it('keeps a final step that says something other than the message', () => {
    // Matching on the kind alone would delete part of the record.
    expect(
      stepText(
        projectMessage({
          role: 'assistant',
          content: 'the answer',
          activity: [event('final', { text: 'an earlier draft' })],
        }),
      ),
    ).toEqual(['an earlier draft']);
  });

  it('still excludes a bare done event', () => {
    // Excluded for being a `done`, not for repeating the answer: its text is
    // different here, so ordinary de-duplication cannot account for it.
    expect(
      projectMessage({
        role: 'assistant',
        content: 'the answer',
        activity: [event('done', { text: 'a frame the turn ended with' })],
      }).steps,
    ).toEqual([]);
  });

  it('is empty for a user message', () => {
    const row = projectMessage({ role: 'user', content: 'ask', activity });
    expect(row.steps).toEqual([]);
    expect(row.text).toBe('ask');
    expect(row.outcome).toBe('none');
  });

  it('degrades to nothing for a message stored before activity existed', () => {
    // Those conversations are history and cannot be regenerated. Rendering
    // fewer steps is right; refusing to render them is not.
    expect(projectMessage({ role: 'assistant', content: 'old' }).steps).toEqual([]);
    expect(projectMessage({ role: 'assistant', content: 'old', activity: null }).steps).toEqual([]);
  });
});

describe('projectTurn', () => {
  it('takes the answer out of the steps rather than beside them', () => {
    // Two projections \u2014 one for the timeline, one for the answer \u2014 is
    // how the answer came to be printed twice.
    const row = projectTurn([
      event('decision', { action: 'plan', task: 'a' }),
      event('final', { text: 'the answer' }),
      event('done', { text: 'the answer', outcome: 'final_answer' }),
    ]);
    expect(stepText(row)).toEqual(['plan: a']);
    expect(row.text).toBe('the answer');
    expect(row.outcome).toBe('answer');
  });

  it('prefers the last non-empty terminal event', () => {
    expect(
      projectTurn([event('final', { text: 'first' }), event('final', { text: 'second' })]).text,
    ).toBe('second');
  });

  it('skips an empty done and keeps looking backwards', () => {
    expect(projectTurn([event('final', { text: 'real' }), event('done', { text: '' })]).text).toBe(
      'real',
    );
  });

  it('has no answer and no outcome before the turn has ended', () => {
    const row = projectTurn([event('role_start', { role: 'planner' })]);
    expect(row.text).toBe('');
    expect(row.outcome).toBe('none');
  });

  it('does not call an interrupted turn answered', () => {
    // The backend writes a `done` with a null outcome for a cancelled turn.
    // Whatever text it had produced is still shown; nobody answered.
    const row = projectTurn([
      event('final', { text: 'half an answer' }),
      event('done', { text: 'half an answer', outcome: null }),
    ]);
    expect(row.text).toBe('half an answer');
    expect(row.outcome).toBe('none');
  });

  it('reads a failure recorded on the done frame, in either spelling', () => {
    // The backend sends an object; older stored activity carries a bare string.
    // Reading only the string found `""` for every real failure and reported it
    // as a turn that had merely been stopped.
    expect(
      projectTurn([
        {
          kind: 'done',
          text: 'stopped',
          outcome: null,
          failure: { code: 'runtime_error', message: 'the agent crashed' },
        },
      ]).outcome,
    ).toBe('failure');
    expect(
      projectTurn([{ kind: 'done', text: 'stopped', outcome: null, failure: 'agent crashed' }])
        .outcome,
    ).toBe('failure');
    // `failure: null` is what a turn that did not fail carries.
    expect(
      projectTurn([{ kind: 'done', text: 'answered', outcome: 'final_answer', failure: null }])
        .outcome,
    ).toBe('answer');
  });

  it('agrees with the stored copy about a turn that was stopped', () => {
    // The same turn, live and reloaded. A stopped turn's text breaks off
    // mid-thought, so whichever way the reader arrives at it, it must not be
    // labelled an answer — and the two must not disagree, or the label would
    // change under a reader who simply reloaded the page.
    const live = projectTurn([
      event('final', { text: 'Stopped while the planner was working.' }),
      event('done', { text: 'Stopped while the planner was working.', outcome: 'cancelled' }),
    ]);
    const stored = projectMessage({
      role: 'assistant',
      content: 'Stopped while the planner was working.',
      activity: [
        {
          kind: 'final',
          text: 'Stopped while the planner was working.',
          outcome: 'cancelled',
        },
      ],
    });
    expect(stored.outcome).toBe(live.outcome);
    expect(stored.outcome).toBe('stopped');
    expect(stored.text).toBe(live.text);
  });

  it('does not call an ending it cannot read an answer', () => {
    // Two endings this build cannot characterise: the one older backends sent
    // for a stop, and whatever is added after this reader was written. Calling
    // either an answer puts a reply in front of the reader that nobody made.
    expect(projectTurn([event('done', { text: 'Stopped.', outcome: null })]).outcome).toBe('none');
    expect(
      projectTurn([event('done', { text: 'Handed over.', outcome: 'delegated_to_human' })]).outcome,
    ).toBe('none');
  });
});

describe('activeRole', () => {
  it('is the most recent role named', () => {
    expect(
      activeRole([
        event('role_start', { role: 'planner' }),
        event('role_start', { role: 'implementer' }),
      ]),
    ).toBe('implementer');
  });

  it('is null before any role has started', () => {
    expect(activeRole([event('session', {})])).toBeNull();
  });
});

describe('mergeEarlier', () => {
  const message = (id: number | undefined, content: string): StoredMessage => ({
    id,
    role: 'user',
    content,
  });

  it('puts the older page first', () => {
    expect(
      mergeEarlier([message(1, 'a'), message(2, 'b')], [message(3, 'c')], 0, 2).map(
        (m) => m.content,
      ),
    ).toEqual(['a', 'b', 'c']);
  });

  it('does not duplicate a message that both pages contain', () => {
    // The conversation can grow between the two reads, so the pages overlap.
    // The shared message sits at position 1 of the older page and position 2 of
    // the newer one, which is what makes this a test of identity: matching on
    // position would keep both copies.
    expect(
      mergeEarlier(
        [message(1, 'a'), message(2, 'b')],
        [message(2, 'b'), message(3, 'c')],
        0,
        2,
      ).map((m) => m.content),
    ).toEqual(['a', 'b', 'c']);
  });

  it('falls back to position for messages written before ids were published', () => {
    expect(
      mergeEarlier(
        [message(undefined, 'a'), message(undefined, 'b')],
        [message(undefined, 'b'), message(undefined, 'c')],
        0,
        1,
      ).map((m) => m.content),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('job steps', () => {
  it('describes a managed run that carries no text at all', () => {
    // `job` events have no `text` field; reading only `text` dropped every
    // simulation the agent started.
    expect(
      toStep({
        kind: 'job',
        status: 'running',
        experimentId: '20260907_0_llama3',
        jobKind: 'simulation',
      })?.text,
    ).toBe('simulation 20260907_0_llama3: running');
  });

  it('falls back to the job id when there is no experiment yet', () => {
    expect(toStep({ kind: 'job', status: 'queued', jobId: 'j-17' })?.text).toBe('run j-17: queued');
  });

  it('shows one run once, where it started, saying what it is doing now', () => {
    // A job publishes an event per state change. Three lines for one run reads
    // as three runs; putting the card at the newest event instead marches every
    // finished run to the end of the turn, away from the decision that started
    // it.
    const steps = toTimeline([
      event('job', { experimentId: 'e1', status: 'queued', jobKind: 'simulation' }),
      event('decision', { action: 'wait', task: 'for the run' }),
      event('job', { experimentId: 'e1', status: 'running', jobKind: 'simulation' }),
      event('job', { experimentId: 'e1', status: 'finished', jobKind: 'simulation' }),
    ]);
    expect(stepText({ steps })).toEqual(['simulation e1: finished', 'wait: for the run']);
  });

  it('counts one experiment extended by several launcher jobs as one run', () => {
    // The resource comes first in the key, because that is the thing a reader
    // thinks of as "the run".
    const steps = toTimeline([
      event('job', { resourceId: 'r1', jobId: 'j-1', status: 'running' }),
      event('job', { resourceId: 'r1', jobId: 'j-2', status: 'finished' }),
    ]);
    expect(steps).toHaveLength(1);
  });

  it('keeps two different runs apart', () => {
    expect(
      toTimeline([
        event('job', { experimentId: 'e1', status: 'running' }),
        event('job', { experimentId: 'e2', status: 'running' }),
      ]),
    ).toHaveLength(2);
  });
});

describe('narration recorded as a payload rather than as prose', () => {
  it('prints the message, not the object it arrived in', () => {
    // Older turns wrote `{"action": ..., "message": ...}` into the text field.
    // Printed verbatim it shows the reader a serialized object.
    expect(
      toStep(
        event('intermediate_output', { text: '{"action":"plan","message":"reading the run"}' }),
      )?.text,
    ).toBe('reading the run');
  });

  it('promotes a milestone the payload declares', () => {
    expect(
      toStep(event('intermediate_output', { text: '{"action":"milestone","message":"done"}' }))
        ?.milestone,
    ).toBe(true);
  });

  it('drops bookkeeping that was never meant to be read', () => {
    // No message, only fields the machinery used.
    expect(
      toStep(event('intermediate_output', { text: '{"action":"plan","task":"a"}' })),
    ).toBeNull();
  });

  it('leaves text alone that merely looks like JSON', () => {
    expect(toStep(event('intermediate_output', { text: '{not json after all}' }))?.text).toBe(
      '{not json after all}',
    );
  });
});

describe('messages written before activity existed', () => {
  it('recovers the narration from intermediate_outputs', () => {
    // "No activity" is not "recorded no steps".
    expect(
      projectMessage({
        role: 'assistant',
        content: 'the answer',
        intermediate_outputs: [
          { role: 'orchestrator', level: 'progress', text: 'reading the run' },
          { text: '' },
        ],
      }).steps.map((step) => [step.role, step.text]),
    ).toEqual([['orchestrator', 'reading the run']]);
  });

  it('recovers narration that exists only inside the old body wrapper', () => {
    // Taking the wrapper off is a deletion unless what was inside it is put
    // somewhere: those turns recorded their narration nowhere else.
    const row = projectMessage({
      role: 'assistant',
      content:
        '<details class="role-output orchestrator"><summary>Orchestrator</summary>read the run</details>\n\nthe answer',
    });
    expect(row.text).toBe('the answer');
    expect(row.steps.map((step) => [step.role, step.text])).toEqual([
      ['orchestrator', 'read the run'],
    ]);
  });

  it('recovers an orchestrator preamble as narration', () => {
    const row = projectMessage({
      role: 'assistant',
      content: '### Orchestrator\n\nthinking out loud\n\n### Message\n\nthe answer',
    });
    expect(row.text).toBe('the answer');
    expect(stepText(row)).toEqual(['thinking out loud']);
  });

  it('does not print a preamble with nothing after it twice', () => {
    // A preamble is only a preamble when something follows it. With no section
    // to cut at, the narration reader took it as narration while the answer
    // reader kept it in the body — so the same words appeared as a step and
    // again as the answer below.
    const row = projectMessage({
      role: 'assistant',
      content: '### Orchestrator\n\nthat is all there was',
    });
    expect(row.text).toBe('### Orchestrator\n\nthat is all there was');
    expect(stepText(row)).toEqual([]);
  });

  it('prefers activity when both are present', () => {
    expect(
      stepText(
        projectMessage({
          role: 'assistant',
          content: 'the answer',
          activity: [{ kind: 'decision', action: 'plan', task: 'a' }],
          intermediate_outputs: [{ text: 'older narration' }],
        }),
      ),
    ).toEqual(['plan: a']);
  });
});

describe('the body of a stored message', () => {
  /** What the reader is shown as the message itself, wrappers taken off. */
  const said = (message: Parameters<typeof projectMessage>[0]) => projectMessage(message).text;

  it('leaves a user message alone', () => {
    expect(said({ role: 'user', content: '### Orchestrator stays' })).toBe(
      '### Orchestrator stays',
    );
  });

  it('drops the old role-output wrapper', () => {
    expect(
      said({
        role: 'assistant',
        content: '<details class="role-output orchestrator">narration</details>\n\nthe answer',
      }),
    ).toBe('the answer');
  });

  it('drops an orchestrator preamble and the Message heading', () => {
    expect(
      said({
        role: 'assistant',
        content: '### Orchestrator\n\nthinking out loud\n\n### Message\n\nthe answer',
      }),
    ).toBe('the answer');
  });

  it('keeps the heading of a section the reader still wants', () => {
    expect(
      said({
        role: 'assistant',
        content: '### Orchestrator\n\nplanning\n\n### Error\n\nit failed',
      }),
    ).toBe('### Error\n\nit failed');
  });

  it('leaves a message written today untouched', () => {
    expect(said({ role: 'assistant', content: 'plain answer' })).toBe('plain answer');
  });
});
