import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSettings } from '../../application/conversationRepository';
import AgentModePicker from './AgentModePicker';

function Harness({
  initial = { agentMode: 'orchestrated', autonomous: true } as AgentSettings,
  locked = false,
  disabled = false,
  onChange,
}: {
  initial?: AgentSettings;
  locked?: boolean;
  disabled?: boolean;
  onChange?: (settings: AgentSettings) => void;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <AgentModePicker
      settings={settings}
      locked={locked}
      disabled={disabled}
      onChange={(next) => {
        onChange?.(next);
        setSettings(next);
      }}
    />
  );
}

const checkedCells = () =>
  screen.getAllByRole('radio').filter((cell) => cell.getAttribute('aria-checked') === 'true');

describe('agent mode picker', () => {
  it('offers all four combinations and marks exactly the chosen one', () => {
    render(<Harness />);

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    // Never a whole row: on a two-column grid that would read as "both columns
    // hold", which is the one thing that is never true here.
    expect(checkedCells()).toHaveLength(1);
    expect(checkedCells()[0]).toHaveAccessibleName('Two agents, decides and reports');
  });

  it('reports both axes from one click and moves the mark', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'One agent, stops to ask you' }));

    expect(onChange).toHaveBeenCalledWith({ agentMode: 'single', autonomous: false });
    expect(checkedCells()).toHaveLength(1);
    expect(checkedCells()[0]).toHaveAccessibleName('One agent, stops to ask you');
  });

  it('restates the choice in the same words the grid uses', () => {
    render(<Harness initial={{ agentMode: 'single', autonomous: false }} />);

    expect(screen.getByText(/asking you when unsure/)).toHaveTextContent(
      'One agent, asking you when unsure.',
    );
  });

  it('drops the grid once the first message pins the working style', () => {
    render(<Harness initial={{ agentMode: 'single', autonomous: true }} locked />);

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // The sentence stays, so a started conversation still says what it is.
    expect(screen.getByText(/deciding without asking you/)).toHaveTextContent(
      'One agent, deciding without asking you.',
    );
  });

  it('stays readable but unusable while a turn is streaming', () => {
    render(<Harness disabled />);

    for (const cell of screen.getAllByRole('radio')) expect(cell).toBeDisabled();
  });
});
