import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type { CodexModelOption, CodexRoleRuntime, CodexRuntimeSelection } from './agentTypes';
import type { CodexRoleName } from './agentMode';
import CodexRuntimePicker from './CodexRuntimePicker';
import { runtimeModel } from './codexRuntime';

const MODELS: readonly CodexModelOption[] = [
  ...['sonnet', 'opus'].map((model) => ({
    id: `claude-${model}-5`,
    label: model === 'sonnet' ? 'Claude Sonnet 5' : 'Claude Opus 5',
    family: 'claude',
    familyLabel: 'Claude',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    serviceTiers: ['default'] as const,
    defaultServiceTier: 'default' as const,
    available: true,
  })),
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6-Sol',
    family: 'gpt',
    familyLabel: 'GPT-5.6',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'xhigh',
    serviceTiers: ['default', 'fast'],
    defaultServiceTier: 'default',
    available: true,
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6-Luna',
    family: 'gpt',
    familyLabel: 'GPT-5.6',
    efforts: ['low', 'high'],
    defaultEffort: 'high',
    serviceTiers: ['default', 'fast'],
    defaultServiceTier: 'default',
    available: true,
  },
  {
    id: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    label: 'DeepSeek V4 Flash 0731 (Cayenne vLLM)',
    family: 'deepseek',
    familyLabel: 'DeepSeek',
    efforts: ['high', 'xhigh', 'max'],
    defaultEffort: 'max',
    serviceTiers: ['default'],
    defaultServiceTier: 'default',
    available: true,
  },
];

function Harness({
  locked = false,
  roles,
  models = MODELS,
  initialRuntime = { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
}: {
  locked?: boolean;
  roles?: readonly CodexRoleName[];
  models?: readonly CodexModelOption[];
  initialRuntime?: CodexRoleRuntime;
}) {
  const [selection, setSelection] = useState<CodexRuntimeSelection>({
    orchestrator: initialRuntime,
    implementer: initialRuntime,
    assistant: initialRuntime,
  });
  const family = initialRuntime.provider ?? runtimeModel(models, initialRuntime)?.family ?? '';
  return (
    <>
      <output data-testid="runtime-selection">{JSON.stringify(selection)}</output>
      <CodexRuntimePicker
        models={models}
        selection={selection}
        roles={roles}
        lockedFamilies={
          locked ? { orchestrator: family, implementer: family, assistant: family } : null
        }
        onChange={(role, runtime) => setSelection((current) => ({ ...current, [role]: runtime }))}
      />
    </>
  );
}

describe('Agent runtime picker', () => {
  const CONNECTION_MODELS = ['work', 'personal'].map((connection) => ({
    ...MODELS[0]!,
    family: connection,
    familyLabel: connection,
  }));

  it('restores and selects the exact connection when model IDs are shared', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        roles={['assistant']}
        models={CONNECTION_MODELS}
        initialRuntime={{
          provider: 'personal',
          model: 'claude-sonnet-5',
          effort: 'high',
          serviceTier: 'default',
        }}
      />,
    );
    await user.click(screen.getByLabelText('Assistant Agent runtime'));
    const cells = screen.getAllByRole('radio', { name: 'Claude Sonnet 5 at high' });
    expect(cells[0]).not.toBeChecked();
    expect(cells[1]).toBeChecked();
    await user.click(cells[0]!);
    expect(cells[0]).toBeChecked();
    expect(cells[1]).not.toBeChecked();
    expect(
      JSON.parse(screen.getByTestId('runtime-selection').textContent!).assistant.provider,
    ).toBe('work');
  });

  it('locks a historical session to its actual connection, including shared model IDs', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        locked
        roles={['assistant']}
        models={CONNECTION_MODELS}
        initialRuntime={{
          provider: 'personal',
          model: 'claude-sonnet-5',
          effort: 'high',
          serviceTier: 'default',
        }}
      />,
    );
    await user.click(screen.getByLabelText('Assistant Agent runtime'));
    const cells = screen.getAllByRole('radio', { name: 'Claude Sonnet 5 at high' });
    expect(cells[0]).toBeDisabled();
    expect(cells[1]).not.toBeDisabled();
    expect(cells[1]).toBeChecked();
  });

  it('does not guess an ambiguous legacy connection or substitute a missing connection', () => {
    const runtime = { model: 'claude-sonnet-5', effort: 'high', serviceTier: 'default' as const };
    expect(runtimeModel(CONNECTION_MODELS, runtime)).toBeUndefined();
    expect(runtimeModel(CONNECTION_MODELS, { ...runtime, provider: 'retired' })).toBeUndefined();
    expect(runtimeModel(MODELS, runtime)?.family).toBe('claude');
  });

  it('selects Claude for one role and resets an unsupported Fast tier', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByLabelText('Implementer Agent runtime'));
    await user.click(screen.getByRole('button', { name: 'Implementer Fast tier' }));
    await user.click(screen.getByRole('radio', { name: 'Claude Sonnet 5 at high' }));
    expect(screen.getByLabelText('Implementer Agent runtime')).toHaveTextContent('Claude Sonnet');
    expect(screen.getByLabelText('Orchestrator Agent runtime')).toHaveTextContent('Sol');
    expect(screen.getByTestId('implementer-fast-indicator')).toHaveTextContent('N');
    expect(screen.getByRole('button', { name: 'Implementer Fast tier' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Claude Sonnet 5 at xhigh' }));
    expect(screen.getByLabelText('Implementer Agent runtime')).toHaveTextContent('xhigh');
  });

  it('allows single Claude and same-family model changes after history exists', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        roles={['assistant']}
        locked
        initialRuntime={{ model: 'claude-sonnet-5', effort: 'high', serviceTier: 'default' }}
      />,
    );
    await user.click(screen.getByLabelText('Assistant Agent runtime'));
    expect(screen.getByRole('radio', { name: 'GPT-5.6-Sol at high' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Claude Opus 5 at max' }));
    expect(screen.getByLabelText('Assistant Agent runtime')).toHaveTextContent('Claude Opus');
    expect(screen.getByLabelText('Assistant Agent runtime')).toHaveTextContent('max');
  });

  it('disables unconfigured Claude models and explains their availability', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        models={MODELS.map((model) =>
          model.family === 'claude' ? { ...model, available: false } : model,
        )}
      />,
    );
    await user.click(screen.getByLabelText('Implementer Agent runtime'));
    expect(screen.getByRole('radio', { name: 'Claude Sonnet 5 at high' })).toBeDisabled();
    await user.hover(screen.getByText('Claude Sonnet 5'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Claude is not configured on this server.',
    );
  });

  it('picks a model and effort from one cell of the grid', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Orchestrator Agent runtime'));
    await user.click(screen.getByRole('radio', { name: 'GPT-5.6-Luna at low' }));

    expect(screen.getByLabelText('Orchestrator Agent runtime')).toHaveTextContent('Luna');
    expect(screen.getByLabelText('Orchestrator Agent runtime')).toHaveTextContent('low');
  });

  it('leaves out cells for a level the model does not offer', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Orchestrator Agent runtime'));

    // Luna has neither `medium` nor `xhigh`; Sol offers both.
    expect(screen.queryByRole('radio', { name: 'GPT-5.6-Luna at xhigh' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'GPT-5.6-Sol at xhigh' })).toBeChecked();
  });

  it('changes the per-role service tier and exposes it on the closed chip', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const indicator = screen.getByTestId('orchestrator-fast-indicator');

    expect(indicator).toHaveTextContent('N');

    await user.click(screen.getByLabelText('Orchestrator Agent runtime'));
    await user.click(screen.getByRole('button', { name: 'Orchestrator Fast tier' }));

    expect(indicator).toHaveTextContent('F');
  });

  it('locks the other family once the conversation has history, but not effort', async () => {
    const user = userEvent.setup();
    render(<Harness locked />);

    await user.click(screen.getByLabelText('Implementer Agent runtime'));

    expect(screen.getByRole('radio', { name: 'DeepSeek V4 Flash at max' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'GPT-5.6-Luna at low' })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: 'GPT-5.6-Sol at medium' }));
    expect(screen.getByLabelText('Implementer Agent runtime')).toHaveTextContent('medium');
  });

  it('shows one chip for the single-agent cast and none of the delegating pair', () => {
    render(<Harness roles={['assistant']} />);

    expect(screen.getByLabelText('Assistant Agent runtime')).toBeInTheDocument();
    expect(screen.queryByLabelText('Orchestrator Agent runtime')).toBeNull();
    expect(screen.queryByLabelText('Implementer Agent runtime')).toBeNull();
  });
});
