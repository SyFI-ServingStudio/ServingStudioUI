import { describe, expect, it } from 'vitest';

import type {
  ConversationMessage,
  ConversationTurnEvent,
} from '../../application/conversationRepository';
import { conversationOutline, outlineEntryCounts, plainTextExcerpt } from './conversationOutline';

function assistant(activity: readonly ConversationTurnEvent[]): ConversationMessage {
  return { role: 'assistant', content: '', activity };
}

const milestone = (text: string): ConversationTurnEvent => ({
  kind: 'intermediate_output',
  role: 'orchestrator',
  level: 'milestone',
  text,
});

describe('plainTextExcerpt', () => {
  it('flattens the Markdown subset agents write into one scannable line', () => {
    expect(
      plainTextExcerpt('## Ready\n\n- Compared **TP=2** and `TP=4` in [the sweep](#/aggregate)\n'),
    ).toBe('Ready Compared TP=2 and TP=4 in the sweep');
  });

  it('truncates past the limit with an ellipsis', () => {
    expect(plainTextExcerpt('a'.repeat(40), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('conversationOutline', () => {
  it('groups milestones, results and the answer under the question that prompted them', () => {
    const outline = conversationOutline(
      [
        { role: 'user', content: 'Compare TP choices.' },
        assistant([
          { kind: 'intermediate_output', role: 'orchestrator', text: 'Reading the preset.' },
          milestone('Scoped the sweep to TP=2 and TP=4.'),
          { kind: 'decision', action: 'delegate', task: 'Run the sweep.' },
          { kind: 'intermediate_output', role: 'implementer', level: 'milestone', text: 'Ran it.' },
          {
            kind: 'job',
            workspaceId: 'w_main',
            status: 'ready',
            experimentId: 'e_sweep',
            experimentPath: '20260731_0_sweep',
            jobId: 'j_1',
            jobKind: 'timing_predict',
            resourceId: 'p_1',
            analyzerResourceId: 'p_1',
            artifactPath: 'logs/20260731_0_predict',
          },
          { kind: 'final', text: 'TP=2 wins on throughput.' },
        ]),
      ],
      0,
      [],
      false,
    );
    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({
      blockId: 't0',
      question: 'Compare TP choices.',
      live: false,
    });
    expect(outline[0].entries).toEqual([
      {
        anchorId: 't1-c0-n1',
        blockId: 't1-c0',
        fallbackBlockId: 't1',
        kind: 'milestone',
        label: 'Scoped the sweep to TP=2 and TP=4.',
      },
      {
        anchorId: 't1-c3',
        blockId: 't1-c3',
        fallbackBlockId: 't1',
        kind: 'result',
        label: 'logs/20260731_0_predict',
        detail: 'timing prediction · ready',
        status: 'ready',
      },
      {
        anchorId: 't1-c4',
        blockId: 't1-c4',
        fallbackBlockId: 't1',
        kind: 'answer',
        label: 'TP=2 wins on throughput.',
      },
    ]);
  });

  it('indexes clarification requests apart from final answers', () => {
    const outline = conversationOutline(
      [
        { role: 'user', content: 'Run it.' },
        assistant([
          { kind: 'final', text: 'Which GPU should I use?', outcome: 'request_user_input' },
        ]),
      ],
      0,
      [],
      false,
    );
    expect(outline[0].entries).toMatchObject([{ kind: 'input-needed' }]);
  });

  it('keeps anchor ids stable when earlier messages are prepended', () => {
    const messages: readonly ConversationMessage[] = [
      { role: 'user', content: 'Second question.' },
      assistant([milestone('Answered the second question.')]),
    ];
    expect(conversationOutline(messages, 4, [], false)[0]).toMatchObject({
      blockId: 't4',
      entries: [{ anchorId: 't5-c0-n0', blockId: 't5-c0', fallbackBlockId: 't5' }],
    });
  });

  it('appends the streaming turn to the open group and marks it live', () => {
    const outline = conversationOutline(
      [{ role: 'user', content: 'Now try EP=8.' }],
      0,
      [milestone('Re-ran with EP=8.')],
      true,
    );
    expect(outline).toMatchObject([
      {
        question: 'Now try EP=8.',
        live: true,
        entries: [{ anchorId: 'live-c0-n0', blockId: 'live-c0', kind: 'milestone' }],
      },
    ]);
  });

  it('drops turns that produced nothing worth indexing', () => {
    expect(
      conversationOutline(
        [
          { role: 'user', content: 'Hello.' },
          assistant([{ kind: 'intermediate_output', role: 'orchestrator', text: 'Thinking.' }]),
        ],
        0,
        [],
        false,
      ),
    ).toEqual([]);
  });

  it('counts each indexed kind for the rail header', () => {
    const outline = conversationOutline(
      [
        { role: 'user', content: 'Go.' },
        assistant([milestone('One.'), milestone('Two.'), { kind: 'final', text: 'Done.' }]),
      ],
      0,
      [],
      false,
    );
    expect(outlineEntryCounts(outline)).toEqual({ milestones: 2, results: 0, answers: 1 });
  });

  it('indexes milestones from the single-agent cast too', () => {
    // The gate used to be `role !== 'orchestrator'`, which only kept working
    // because `assistant` was folded into `orchestrator` upstream. Once that
    // fold went away it would have silently emptied every single-agent rail.
    const outline = conversationOutline(
      [
        { role: 'user', content: 'Build it.' },
        assistant([
          { kind: 'intermediate_output', role: 'assistant', text: 'Reading the preset.' },
          {
            kind: 'intermediate_output',
            role: 'assistant',
            level: 'milestone',
            text: 'Landed the change.',
          },
          { kind: 'final', text: 'Done.', outcome: 'final_answer' },
        ]),
      ],
      0,
      [],
      false,
    );

    expect(outlineEntryCounts(outline).milestones).toBe(1);
    expect(outline.flatMap((group) => group.entries)).toContainEqual(
      expect.objectContaining({ kind: 'milestone', label: 'Landed the change.' }),
    );
  });
});
