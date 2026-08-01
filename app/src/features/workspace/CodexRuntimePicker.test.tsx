import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import type {
  CodexModelOption,
  CodexRuntimeSelection,
} from '../../application/conversationRepository';
import CodexRuntimePicker from './CodexRuntimePicker';

const MODELS: readonly CodexModelOption[] = [
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

function Harness({ locked = false }: { locked?: boolean }) {
  const [selection, setSelection] = useState<CodexRuntimeSelection>({
    orchestrator: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
    implementer: { model: 'gpt-5.6-sol', effort: 'xhigh', serviceTier: 'default' },
  });
  return (
    <CodexRuntimePicker
      models={MODELS}
      selection={selection}
      lockedFamilies={locked ? { orchestrator: 'gpt', implementer: 'gpt' } : null}
      onChange={(role, runtime) => setSelection((current) => ({ ...current, [role]: runtime }))}
    />
  );
}

describe('Codex runtime picker', () => {
  it('picks a model and effort from one cell of the grid', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Orchestrator Codex runtime'));
    await user.click(screen.getByRole('radio', { name: 'GPT-5.6-Luna at low' }));

    expect(screen.getByLabelText('Orchestrator Codex runtime')).toHaveTextContent('Luna');
    expect(screen.getByLabelText('Orchestrator Codex runtime')).toHaveTextContent('low');
  });

  it('leaves out cells for a level the model does not offer', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Orchestrator Codex runtime'));

    // Luna has neither `medium` nor `xhigh`; Sol offers both.
    expect(screen.queryByRole('radio', { name: 'GPT-5.6-Luna at xhigh' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'GPT-5.6-Sol at xhigh' })).toBeChecked();
  });

  it('changes the per-role service tier and exposes it on the closed chip', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const indicator = screen.getByTestId('orchestrator-fast-indicator');

    expect(indicator).toHaveTextContent('N');

    await user.click(screen.getByLabelText('Orchestrator Codex runtime'));
    await user.click(screen.getByRole('button', { name: 'Orchestrator Fast tier' }));

    expect(indicator).toHaveTextContent('F');
  });

  it('does not offer Fast for a model whose provider lacks the tier', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByLabelText('Orchestrator Codex runtime'));
    await user.click(screen.getByRole('radio', { name: 'DeepSeek V4 Flash at max' }));

    expect(screen.getByRole('button', { name: 'Orchestrator Fast tier' })).toBeDisabled();
  });

  it('locks the other family once the conversation has history, but not effort', async () => {
    const user = userEvent.setup();
    render(<Harness locked />);

    await user.click(screen.getByLabelText('Implementer Codex runtime'));

    expect(screen.getByRole('radio', { name: 'DeepSeek V4 Flash at max' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'GPT-5.6-Luna at low' })).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: 'GPT-5.6-Sol at medium' }));
    expect(screen.getByLabelText('Implementer Codex runtime')).toHaveTextContent('medium');
  });
});
