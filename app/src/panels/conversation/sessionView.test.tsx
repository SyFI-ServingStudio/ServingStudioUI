import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StoredMessage, TurnEvent } from '../../session/types';
import { ConversationTranscript } from './ConversationTranscript';
import { activeToolCall, eventsForConversation, messageForConversation } from './sessionView';

describe('session conversation view projection', () => {
  it('preserves every rich event the exact transcript renders', () => {
    const events: TurnEvent[] = [
      {
        kind: 'intermediate_output',
        role: 'orchestrator',
        text: 'Inspecting the run.',
        model: 'gpt-6',
        effort: 'high',
        level: 'milestone',
      },
      {
        kind: 'usage',
        role: 'orchestrator',
        model: 'gpt-6',
        effort: 'high',
        duration_ms: 1250,
        tokens: { read: 10, prefill: 20, output: 30 },
      },
      { kind: 'decision', action: 'delegate', task: 'Patch the parser.' },
      { kind: 'implementer', text: 'The parser is fixed.' },
      {
        kind: 'job',
        workspaceId: 'w_main',
        status: 'complete',
        experimentId: 'run_one',
        experimentPath: 'logs/run_one',
        jobId: 'job_one',
        jobKind: 'timing_predict',
        resourceId: 'resource_one',
        analyzerResourceId: 'prediction_one',
        descriptor: { protocol_version: 1 },
        summary: null,
      },
      { kind: 'error', text: 'The run failed.' },
      { kind: 'final', text: 'Please choose a GPU.', outcome: 'request_user_input' },
    ];

    expect(eventsForConversation(events)).toEqual(events);
  });

  it('drops open-vocabulary machinery and keeps the legacy zero/empty fallbacks', () => {
    const events: TurnEvent[] = [
      { kind: 'role_start', role: 'orchestrator' },
      { kind: 'tool_call', text: 'Reading files' },
      { kind: 'usage', role: 'orchestrator', duration_ms: 4, tokens: { read: 1 } },
      { kind: 'job', workspaceId: 'w_main', status: 'running' },
      { kind: 'future_event', text: 'A future client may render this.' },
    ];

    expect(eventsForConversation(events)).toEqual([
      {
        kind: 'usage',
        role: 'orchestrator',
        duration_ms: 4,
        tokens: { read: 1, prefill: 0, output: 0 },
      },
      {
        kind: 'job',
        workspaceId: 'w_main',
        status: 'running',
        experimentId: '',
        experimentPath: '',
        jobId: '',
      },
    ]);
  });

  it('turns the stream done frame into the same final or failure card as the old client', () => {
    expect(
      eventsForConversation([
        { kind: 'done', text: 'Choose a GPU.', outcome: 'request_user_input' },
        {
          kind: 'done',
          text: '(backend error: failed)',
          failure: { code: 'runtime_failure', message: 'Runtime failed.' },
        },
      ]),
    ).toEqual([
      { kind: 'final', text: 'Choose a GPU.', outcome: 'request_user_input' },
      { kind: 'error', text: 'Runtime failed.' },
    ]);
  });

  it('preserves consecutive final frames even when their text matches', () => {
    expect(
      eventsForConversation([
        { kind: 'final', text: 'Same answer.', outcome: 'request_user_input' },
        { kind: 'final', text: 'Same answer.', outcome: 'final_answer' },
      ]),
    ).toEqual([
      { kind: 'final', text: 'Same answer.', outcome: 'request_user_input' },
      { kind: 'final', text: 'Same answer.', outcome: 'final_answer' },
    ]);
  });

  it('normalizes legacy answers while retaining narration, citations, and failures', () => {
    const message: StoredMessage = {
      role: 'assistant',
      content: '### Orchestrator\n\nI will inspect it.\n\n### Message\n\nThe result is ready.',
      intermediate_outputs: [
        { role: 'orchestrator', level: 'milestone', text: 'Loaded the report.' },
      ],
      citations: [
        {
          protocol: 'vibesim.citation/v2',
          token: 'run.throughput',
          sourceStart: 4,
          sourceEnd: 10,
          displayLabel: 'Throughput',
          target: {
            protocol: 'vibesim.analyzer/v2',
            kind: 'aggregate',
            workspaceId: 'w_main',
            experimentId: 'sweep_one',
            panelId: 'throughput',
          },
        },
        {
          protocol: 'vibesim.citation/v2',
          token: 'bad',
          sourceStart: null,
          sourceEnd: null,
          target: null,
        },
      ],
      failure: { code: 'runtime_failure', message: 'Runtime failed.' },
    };

    expect(messageForConversation(message)).toEqual({
      role: 'assistant',
      content: 'The result is ready.',
      activity: [
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          level: 'milestone',
          text: 'Loaded the report.',
        },
        { kind: 'final', text: 'The result is ready.', outcome: 'final_answer' },
      ],
      citations: [
        {
          protocol: 'vibesim.citation/v2',
          token: 'run.throughput',
          sourceStart: 4,
          sourceEnd: 10,
          displayLabel: 'Throughput',
          target: {
            protocol: 'vibesim.analyzer/v2',
            kind: 'aggregate',
            workspaceId: 'w_main',
            experimentId: 'sweep_one',
            panelId: 'throughput',
          },
        },
      ],
      failure: { message: 'Runtime failed.' },
    });
  });

  it('uses recorded activity instead of synthesizing a second final card', () => {
    const message: StoredMessage = {
      role: 'assistant',
      content: 'Done.',
      activity: [
        { kind: 'intermediate_output', role: 'assistant', text: 'Working.' },
        { kind: 'final', text: 'Done.', outcome: 'cancelled' },
      ],
    };

    expect(messageForConversation(message).activity).toEqual([
      {
        kind: 'intermediate_output',
        role: 'assistant',
        level: 'progress',
        text: 'Working.',
      },
      { kind: 'final', text: 'Done.', outcome: 'cancelled' },
    ]);
  });

  it('does not invent a final card when recorded activity only contains unknown events', () => {
    const projected = messageForConversation({
      role: 'assistant',
      content: 'A stored answer.',
      activity: [
        { kind: 'role_start', role: 'assistant' },
        { kind: 'future_event', text: 'Recorded for a future client.' },
      ],
    });

    expect(projected.activity).toEqual([]);

    render(
      <ConversationTranscript
        workspaceId="w_main"
        messages={[projected]}
        messageStartIndex={0}
        liveEvents={[]}
        toolCall=""
        streaming={false}
        error={null}
        canLoadEarlier={false}
        loadingEarlier={false}
        onLoadEarlier={vi.fn()}
        drivingRole="assistant"
        renderMarkdown={(text) => text}
        onOpenManagedResult={vi.fn()}
      />,
    );

    expect(screen.queryByText('A stored answer.')).not.toBeInTheDocument();
  });

  it('keeps the exact legacy runtime-failure explanation', () => {
    const projected = messageForConversation({
      role: 'assistant',
      content: '(backend error: No space left on device)',
    });

    expect(projected.failure?.message).toBe(
      'The Agent runtime could not start because the host disk is full. Free space, then retry this question.',
    );
  });

  function renderTranscript(message: StoredMessage) {
    render(
      <ConversationTranscript
        workspaceId="w_main"
        messages={[messageForConversation(message)]}
        messageStartIndex={0}
        liveEvents={[]}
        toolCall=""
        streaming={false}
        error={null}
        canLoadEarlier={false}
        loadingEarlier={false}
        onLoadEarlier={vi.fn()}
        drivingRole="orchestrator"
        renderMarkdown={(text) => text}
        onOpenManagedResult={vi.fn()}
      />,
    );
  }

  it('keeps the work of a failed turn and closes it with the recorded cause', () => {
    renderTranscript({
      role: 'assistant',
      content: 'The orchestrator repeatedly stopped at a progress checkpoint.',
      activity: [
        { kind: 'role_start', role: 'orchestrator' },
        {
          kind: 'intermediate_output',
          role: 'orchestrator',
          level: 'milestone',
          text: 'Capture parsed.',
        },
        { kind: 'implementer', text: 'Phase 0 is done.' },
        { kind: 'error', text: 'The orchestrator repeatedly stopped at a progress checkpoint.' },
      ],
      failure: {
        code: 'agent_runtime_failure',
        message: 'The Agent runtime failed before producing an answer.',
      },
    } as StoredMessage);

    expect(screen.getByText('Capture parsed.')).toBeInTheDocument();
    expect(screen.getByText('Phase 0 is done.')).toBeInTheDocument();
    expect(
      screen.getByText('The orchestrator repeatedly stopped at a progress checkpoint.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('The Agent runtime failed before producing an answer.'),
    ).not.toBeInTheDocument();
  });

  it('shows the failure message in place of a legacy error answer', () => {
    renderTranscript({ role: 'assistant', content: '(backend error: No space left on device)' });

    expect(screen.getByText(/host disk is full/)).toBeInTheDocument();
    expect(screen.queryByText('(backend error: No space left on device)')).not.toBeInTheDocument();
  });

  it('keeps the newest tool line outside the timeline cards', () => {
    expect(
      activeToolCall([
        { kind: 'tool_call', text: 'Reading A' },
        { kind: 'intermediate_output', role: 'assistant', text: 'Found A' },
        { kind: 'tool_call', text: 'Reading B' },
      ]),
    ).toBe('Reading B');
  });
});
