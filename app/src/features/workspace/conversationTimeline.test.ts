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
});
