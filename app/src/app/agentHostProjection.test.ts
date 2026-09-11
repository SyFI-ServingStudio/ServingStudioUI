import { describe, expect, it } from 'vitest';

import type { CodexRuntimeSelection } from '../panels/conversation/agentTypes';
import {
  lastMessageMarker,
  reconciledRuntime,
  resolvedRuntime,
  roleState,
  shouldSpendArmedInterrupt,
  storedTerminalResult,
  terminalResult,
} from './agentHostProjection';

const defaults: CodexRuntimeSelection = {
  orchestrator: { model: 'default-o', effort: 'high', serviceTier: 'default' },
  implementer: { model: 'default-i', effort: 'high', serviceTier: 'default' },
  assistant: { model: 'default-a', effort: 'high', serviceTier: 'default' },
};

describe('Agent host projections', () => {
  it('keeps a supported selection and repairs unavailable models or service tiers', () => {
    const current: CodexRuntimeSelection = {
      orchestrator: { model: 'available', effort: 'xhigh', serviceTier: 'fast' },
      implementer: { model: 'missing', effort: 'low', serviceTier: 'default' },
      assistant: { model: 'default-only', effort: 'medium', serviceTier: 'fast' },
    };
    expect(
      resolvedRuntime(current, defaults, [
        {
          id: 'available',
          label: 'Available',
          family: 'one',
          familyLabel: 'One',
          efforts: ['xhigh'],
          defaultEffort: 'xhigh',
          serviceTiers: ['default', 'fast'],
          defaultServiceTier: 'default',
          available: true,
        },
        {
          id: 'default-only',
          label: 'Default only',
          family: 'two',
          familyLabel: 'Two',
          efforts: ['medium'],
          defaultEffort: 'medium',
          serviceTiers: ['default'],
          defaultServiceTier: 'default',
          available: true,
        },
      ]),
    ).toEqual({
      orchestrator: current.orchestrator,
      implementer: defaults.implementer,
      assistant: { ...current.assistant, serviceTier: 'default' },
    });
  });

  it('does not overwrite a next-turn runtime choice with the finishing turn refresh', () => {
    const incoming = {
      ...defaults,
      orchestrator: { ...defaults.orchestrator, effort: 'medium' },
    };
    const userChoice = {
      ...defaults,
      orchestrator: { ...defaults.orchestrator, effort: 'xhigh' },
    };
    expect(reconciledRuntime(defaults, null, incoming)).toBe(incoming);
    expect(reconciledRuntime(defaults, defaults, incoming)).toBe(incoming);
    expect(reconciledRuntime(userChoice, defaults, incoming)).toBe(userChoice);
  });

  it('tracks the active role and its interrupt blind window', () => {
    expect(roleState([{ kind: 'role_start', role: 'orchestrator' }])).toEqual({
      activeRole: 'orchestrator',
      pendingRole: 'orchestrator',
    });
    expect(
      roleState([
        { kind: 'role_start', role: 'orchestrator' },
        { kind: 'role_ready', role: 'orchestrator' },
        { kind: 'role_start', role: 'implementer' },
      ]),
    ).toEqual({ activeRole: 'implementer', pendingRole: 'implementer' });
  });

  it('spends an armed interrupt only on a matching ready edge in the same running turn', () => {
    expect(shouldSpendArmedInterrupt(true, 'streaming', '', 2, 1)).toBe(true);
    expect(shouldSpendArmedInterrupt(true, 'streaming', 'orchestrator', 2, 1)).toBe(false);
    expect(shouldSpendArmedInterrupt(true, 'idle', '', 2, 1)).toBe(false);
    expect(shouldSpendArmedInterrupt(true, 'streaming', '', 1, 1)).toBe(false);
  });

  it('distinguishes normal, cancelled, and failed done frames for queue release', () => {
    expect(terminalResult([{ kind: 'done', text: 'answer', outcome: 'final_answer' }])).toBe(
      'completed',
    );
    expect(terminalResult([{ kind: 'done', text: 'stopped', outcome: 'cancelled' }])).toBe(
      'stopped',
    );
    expect(
      terminalResult([{ kind: 'done', text: '', failure: { message: 'runtime failed' } }]),
    ).toBe('failed');
  });

  it('recovers the terminal result from a newly stored row when the done frame was not painted', () => {
    const before = [{ id: 7, role: 'user', content: 'question' }];
    const marker = lastMessageMarker(before);
    expect(
      storedTerminalResult(
        [
          ...before,
          {
            id: 8,
            role: 'assistant',
            content: 'answer',
            activity: [{ kind: 'final', text: 'answer', outcome: 'final_answer' }],
          },
        ],
        marker,
      ),
    ).toBe('completed');
    expect(
      storedTerminalResult(
        [
          ...before,
          {
            id: 9,
            role: 'assistant',
            content: 'stopped',
            activity: [{ kind: 'final', text: 'stopped', outcome: 'cancelled' }],
          },
        ],
        marker,
      ),
    ).toBe('stopped');
    expect(storedTerminalResult(before, marker)).toBeNull();
  });
});
