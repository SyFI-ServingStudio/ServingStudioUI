import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentSettings } from './agentTypes';
import AgentModePicker from './AgentModePicker';

function Harness({
  initial = { agentMode: 'orchestrated', autonomous: true, sandbox: 'read-only' } as AgentSettings,
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
  it('reports both axes from one click and moves the mark', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'Single Agent, Human-in-the-loop' }));

    expect(onChange).toHaveBeenCalledWith({
      agentMode: 'single',
      autonomous: false,
      sandbox: 'read-only',
    });
    expect(checkedCells()).toHaveLength(1);
    expect(checkedCells()[0]).toHaveAccessibleName('Single Agent, Human-in-the-loop');
  });

  it('drops the grid once the first message pins the working style', () => {
    render(
      <Harness initial={{ agentMode: 'single', autonomous: true, sandbox: 'read-only' }} locked />,
    );

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // The sentence stays, so a started conversation still says what it is.
    expect(screen.getByText(/Autonomous/)).toHaveTextContent('Single Agent · Autonomous');
  });

  it('stays readable but unusable while a turn is streaming', () => {
    render(<Harness disabled />);

    for (const cell of screen.getAllByRole('radio')) expect(cell).toBeDisabled();
  });
});
