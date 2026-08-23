import { describe, expect, it } from 'vitest';

import type { ConversationTurnEvent } from '../../application/conversationRepository';
import { conversationCards } from './conversationTimeline';

function job(status: string, jobId: string, experimentId = 'e_sweep'): ConversationTurnEvent {
  return {
    kind: 'job',
    workspaceId: 'w_test',
    status,
    experimentId,
    experimentPath: '20260731_0_sweep',
    jobId,
  };
}

describe('conversationCards managed-run lifecycle', () => {
  it('preserves semantic progress and milestone levels on role notes', () => {
    expect(
      conversationCards([
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          level: 'progress',
          text: 'Checking the sweep.',
        },
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          level: 'milestone',
          text: 'All sweep runs are ready.',
        },
      ]),
    ).toMatchObject([
      {
        type: 'role',
        notes: [
          { level: 'progress', text: 'Checking the sweep.' },
          { level: 'milestone', text: 'All sweep runs are ready.' },
        ],
      },
    ]);
  });

  it('keeps clarification requests distinct from final answers', () => {
    expect(
      conversationCards([
        {
          kind: 'final',
          text: 'Which GPU should I use?',
          outcome: 'request_user_input',
        },
      ]),
    ).toEqual([
      {
        type: 'response',
        text: 'Which GPU should I use?',
        outcome: 'request_user_input',
      },
    ]);
  });

  it('renders one latest-state card for all transitions of one experiment', () => {
    const cards = conversationCards([
      job('simulation.requested', 'j_first'),
      job('running', 'j_first'),
      job('analysis_running', 'j_first'),
      job('ready', 'j_first'),
    ]);

    expect(cards).toEqual([
      {
        type: 'job',
        workspaceId: 'w_test',
        experimentId: 'e_sweep',
        experimentPath: '20260731_0_sweep',
        status: 'ready',
      },
    ]);
  });

  it('collapses extension jobs that update the same experiment', () => {
    const cards = conversationCards([
      job('running', 'j_initial'),
      job('ready', 'j_initial'),
      { kind: 'intermediate_output', role: 'implementer', text: 'Extending the sweep.' },
      job('simulation.requested', 'j_extension'),
      job('running', 'j_extension'),
      job('ready', 'j_extension'),
    ]);

    expect(cards.filter((card) => card.type === 'job')).toEqual([
      {
        type: 'job',
        workspaceId: 'w_test',
        experimentId: 'e_sweep',
        experimentPath: '20260731_0_sweep',
        status: 'ready',
      },
    ]);
  });

  it('updates experiments in place when stop events finalize several lifecycles', () => {
    const cards = conversationCards([
      job('running', 'j_one', 'e_one'),
      { kind: 'intermediate_output', role: 'orchestrator', text: 'Watching experiment one.' },
      job('running', 'j_two', 'e_two'),
      { kind: 'intermediate_output', role: 'orchestrator', text: 'Watching experiment two.' },
      job('interrupted', 'j_one', 'e_one'),
      job('interrupted', 'j_two', 'e_two'),
    ]);

    expect(
      cards.map((card) =>
        card.type === 'job'
          ? `job:${card.experimentId}:${card.status}`
          : card.type === 'role'
            ? `role:${card.notes[0]?.text}`
            : card.type,
      ),
    ).toEqual([
      'job:e_one:interrupted',
      'role:Watching experiment one.',
      'job:e_two:interrupted',
      'role:Watching experiment two.',
    ]);
  });

  it('keeps independent experiments as independent lifecycle cards', () => {
    const cards = conversationCards([
      job('running', 'j_one', 'e_one'),
      job('ready', 'j_two', 'e_two'),
    ]);

    expect(cards.filter((card) => card.type === 'job')).toHaveLength(2);
  });

  it('collapses typed job transitions by resource without pretending it is an experiment', () => {
    const typedJob = (status: string): ConversationTurnEvent => ({
      kind: 'job',
      workspaceId: 'w_test',
      status,
      experimentId: '',
      experimentPath: '',
      jobId: 'j_profile',
      jobKind: 'kernel_profile',
      resourceId: 'jr_profile',
      artifactPath: '20260731_0_single_gemm_profile',
      descriptor: { table: 'single_gemm', pointCount: 4 },
      summary: status === 'ready' ? { axes: ['m'] } : null,
    });

    expect(
      conversationCards([typedJob('requested'), typedJob('running'), typedJob('ready')]),
    ).toEqual([
      {
        type: 'job',
        workspaceId: 'w_test',
        experimentId: '',
        experimentPath: '',
        status: 'ready',
        jobId: 'j_profile',
        jobKind: 'kernel_profile',
        resourceId: 'jr_profile',
        artifactPath: '20260731_0_single_gemm_profile',
        descriptor: { table: 'single_gemm', pointCount: 4 },
        summary: { axes: ['m'] },
      },
    ]);
  });

  it('keeps a single-agent turn under its own role and round counter', () => {
    // Before `assistant` was a role of its own, `roleFrom` folded it into the
    // orchestrator: the card rendered under the wrong name and colour, and the
    // two shared a round counter even though they never run together.
    expect(
      conversationCards([
        { kind: 'intermediate_output', role: 'assistant', level: 'progress', text: 'Reading.' },
        {
          kind: 'usage',
          role: 'assistant',
          duration_ms: 10,
          tokens: { read: 1, prefill: 1, output: 1 },
        },
        { kind: 'intermediate_output', role: 'assistant', level: 'milestone', text: 'Built it.' },
      ]),
    ).toMatchObject([
      { type: 'role', role: 'assistant', round: 1 },
      { type: 'role', role: 'assistant', round: 2 },
    ]);
  });

  it('emits no handoff cards when one agent does both jobs', () => {
    const cards = conversationCards([
      { kind: 'intermediate_output', role: 'assistant', level: 'progress', text: 'Editing.' },
      { kind: 'final', text: 'Done.', outcome: 'final_answer' },
    ]);

    expect(cards.some((card) => card.type === 'handoff')).toBe(false);
  });
});

describe('conversationCards round boundaries', () => {
  const note = (text: string): ConversationTurnEvent => ({
    kind: 'intermediate_output',
    role: 'assistant',
    level: 'progress',
    text,
  });
  const usage: ConversationTurnEvent = {
    kind: 'usage',
    role: 'assistant',
    duration_ms: 1,
    tokens: { read: 0, prefill: 0, output: 0 },
  };

  it('counts one round per call when an experiment lands mid-call', () => {
    // The live stream interleaves job events where they happen, on purpose: the
    // experiment card is what gives the surrounding narration its context. The
    // card it splits is still one call, so both halves carry that call's round
    // and both close when the call reports its usage — a half left open would
    // sit at "working" for the rest of the turn and keep drawing the live
    // activity line.
    const cards = conversationCards([
      note('launching the sweep'),
      job('running', 'j1'),
      note('still monitoring'),
      usage,
      note('verifying the runs'),
      usage,
    ]);

    expect(cards.map((card) => (card.type === 'role' ? card.round : card.type))).toEqual([
      1,
      'job',
      1,
      2,
    ]);
    expect(cards.every((card) => card.type !== 'role' || card.done)).toBe(true);
  });

  it('keeps a checkpoint message inside the call that produced it', () => {
    // `run_turn` emits a checkpoint decision's message before that call's usage
    // event for exactly this reason; if it ever went out after, the message
    // would open the next round's card instead of closing its own.
    const cards = conversationCards([
      note('reading the docs'),
      note('the launch completed'),
      usage,
      note('verifying every run'),
      usage,
    ]);

    expect(cards).toMatchObject([
      {
        type: 'role',
        round: 1,
        notes: [{ text: 'reading the docs' }, { text: 'the launch completed' }],
      },
      { type: 'role', round: 2, notes: [{ text: 'verifying every run' }] },
    ]);
  });
});
