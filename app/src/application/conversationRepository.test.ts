import { describe, expect, it, vi } from 'vitest';

import type { AnalyzerTurnContextV1 } from '../domain/citation';
import { sendConversationTurn } from './conversationRepository';

const context: AnalyzerTurnContextV1 = {
  protocol: 'vibesim.conversation-context/v1',
  selection: { kind: 'aggregate', experimentId: 's_test' },
  citationDictionary: {
    protocol: 'vibesim.citation-dictionary/v1',
    identity: 'dictionary-1',
    document: 'Use `exp.throughput`.',
    entries: [
      {
        token: 'exp.throughput',
        displayLabel: 'Total throughput',
        target: {
          protocol: 'vibesim.analyzer/v1',
          kind: 'aggregate',
          experimentId: 's_test',
          panelId: 'total_tps',
          metricKey: 'total_tps',
        },
      },
    ],
  },
};

describe('conversation repository', () => {
  it('sends the bounded Analyzer context and decodes live events plus frozen citations', async () => {
    const citation = {
      protocol: 'vibesim.citation/v1',
      token: 'exp.throughput',
      sourceStart: 4,
      sourceEnd: 20,
      displayLabel: 'Total throughput',
      target: context.citationDictionary.entries[0]!.target,
    };
    const stream = [
      'event: intermediate_output',
      'data: {"role":"orchestrator","text":"Inspecting."}',
      '',
      'event: done',
      `data: ${JSON.stringify({
        text: 'See `exp.throughput`.',
        citations: [citation],
        citation_dictionary_id: 'dictionary-1',
        citation_dsl_version: 'v1',
      })}`,
      '',
      '',
    ].join('\n');
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(stream, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    const completions: unknown[] = [];

    await sendConversationTurn(
      'c_test',
      'Compare throughput.',
      context,
      {
        event: (event) => events.push(event),
        done: (completion) => completions.push(completion),
      },
      new AbortController().signal,
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      text: 'Compare throughput.',
      analyzerContext: context,
    });
    expect(events).toContainEqual({
      kind: 'intermediate_output',
      role: 'orchestrator',
      text: 'Inspecting.',
    });
    expect(events).toContainEqual({ kind: 'final', text: 'See `exp.throughput`.' });
    expect(completions).toContainEqual({
      text: 'See `exp.throughput`.',
      citations: [citation],
      citationDictionaryId: 'dictionary-1',
      citationDslVersion: 'v1',
    });
  });
});
